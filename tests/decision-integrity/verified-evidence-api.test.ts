import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleVerifiedEvidence} from '../../api/cases/[recordId]/verified-evidence.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(options:{error?:any;canReview?:boolean;origins?:string}={}) {
 const calls:any[]=[];let retrievals=0;
 const source={id:id(4),source_url:'https://evidence.example/spec/v1.txt',expected_sha256:'a'.repeat(64),media_type:'text/plain',max_bytes:1024,version_reference:'v1'};
 const tables:Record<string,any[]>={bridge_actor_roles:[{user_id:id(3),active:true,can_review:options.canReview??true,can_revoke:true}],
  records:[{id:id(1),ingestion_log_id:id(2)}],semantic_rule_versions:[{id:id(5),record_id:id(1),snapshot_id:id(2)}],
  trusted_evidence_sources:[source],source_verification_records:[{id:id(6),record_id:id(1),source_id:id(4),content_bytes:'\\x'+Buffer.from('Actual source content').toString('hex')}],
  evidence_withdrawals:[]};
 const client={auth:{getUser:async()=>({data:{user:{id:id(3)}},error:null})},
  from(table:string){let rows=[...(tables[table]??[])];const q:any={select:()=>q,eq:(key:string,value:any)=>{rows=rows.filter(r=>r[key]===value);return q;},order:()=>q,
   maybeSingle:()=>Promise.resolve({data:rows[0]??null,error:null}),then:(resolve:any)=>Promise.resolve({data:rows,error:null,count:rows.length}).then(resolve)};return q;},
  async rpc(name:string,args:any){calls.push({name,args});return {data:options.error?null:{verification_id:id(6),validation_allowed:false,release_allowed:false},error:options.error??null};},
 };
 async function request(body:any,method='POST',query:any={}) {
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='test-only-secret';
  process.env.PETRAPLAN_EVIDENCE_ALLOWED_ORIGINS=options.origins??'["https://evidence.example"]';
  const res:any={statusCode:200,body:null,status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;return this;},setHeader(){}};
  await handleVerifiedEvidence({method,query:{recordId:id(1),...query},headers:{authorization:'Bearer verified-session'},body},res,{
   createClient:()=>client,retrieveTrustedSource:async(s:any,origins:any)=>{retrievals++;assert.equal(s.source_url,source.source_url);assert.deepEqual(origins,['https://evidence.example']);
    return {bytes:Buffer.from('Actual source content'),mediaType:'text/plain',resolvedAddress:'93.184.216.34',tlsPeerSha256:'b'.repeat(64),sha256:'a'.repeat(64),startedAt:'2026-10-26T12:00:00Z'};},
  } as any);
  return res;
 }
 return {request,calls,get retrievals(){return retrievals;}};
}
test('retrieval ignores client URLs, bytes, digest and verifier and persists only server-observed content',async()=>{
 const f=fixture();const r=await f.request({action:'retrieve',source_id:id(4),rule_version_id:id(5),source_url:'http://127.0.0.1/private',content_hex:'66616b65',verified_by:id(99),expected_sha256:'c'.repeat(64)});
 assert.equal(r.statusCode,201);assert.equal(f.retrievals,1);assert.equal(f.calls.length,1);
 const call=f.calls[0];assert.equal(call.name,'bridge_record_source_verification');assert.equal(call.args.p_actor_id,id(3));
 assert.equal(call.args.p_content_hex,Buffer.from('Actual source content').toString('hex'));assert.equal(call.args.p_snapshot_id,id(2));
 assert.equal('p_expected_sha256' in call.args,false);assert.equal('p_source_url' in call.args,false);
});
test('empty trust configuration and missing migrations fail visibly without fabricated verification',async()=>{
 const empty=fixture({origins:'[]'});assert.equal((await empty.request({action:'retrieve',source_id:id(4),rule_version_id:id(5)})).statusCode,503);
 assert.equal(empty.retrievals,0);assert.equal(empty.calls.length,0);
 const missing=fixture({error:{code:'PGRST202',message:'Missing evidence RPC'}});
 const res=await missing.request({action:'retrieve',source_id:id(4),rule_version_id:id(5)});
 assert.equal(res.statusCode,503);assert.equal(res.body.verification_id,undefined);
});
test('authenticated meaning assessment forwards the real actor and delegates scoped authority checks',async()=>{
 const f=fixture();const r=await f.request({action:'assess',verification_id:id(6),authority_id:id(7),decision:'SUPPORTS',reason:'Explicit meaning review',coverage:'COMPLETE',coverage_reason:'Entire scoped definition checked',anchor:{byte_start:0,byte_end:6,excerpt:'Actual'},criteria:{actual_content_read:true},actor_id:id(99)});
 assert.equal(r.statusCode,201);assert.equal(f.calls[0].name,'bridge_assess_verified_evidence');
 assert.equal(f.calls[0].args.p_actor_id,id(3));assert.equal(f.calls[0].args.p_authority_id,id(7));
});
test('GET returns literal source content and never promotes it to validation or release',async()=>{
 const f=fixture();const res=await f.request({},'GET',{verification_id:id(6)});
 assert.equal(res.statusCode,200);assert.equal(res.body.source_text,'Actual source content');
 assert.equal(res.body.meaning_confirmed,false);assert.equal(res.body.release_allowed,false);
});
test('case mismatches, missing technical rights and source self-assignment are refused',async()=>{
 const f=fixture();assert.equal((await f.request({},'GET',{verification_id:id(99)})).statusCode,404);
 assert.equal((await f.request({action:'register_source',source_id:id(4)})).statusCode,400);
 assert.equal((await fixture({canReview:false}).request({action:'check',rule_version_id:id(5)})).statusCode,403);
});

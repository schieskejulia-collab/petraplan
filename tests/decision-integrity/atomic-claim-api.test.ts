import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleClaim} from '../../api/cases/[recordId]/claim.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(error:any=null) {
 const calls:any[]=[];
 const client={
  auth:{getUser:async()=>({data:{user:{id:id(3)}},error:null})},
  from(table:string) {
   assert.equal(table,'bridge_actor_roles','No direct Claim/evidence writes or compensation deletes are allowed');
   const q:any={select:()=>q,eq:()=>q,maybeSingle:()=>Promise.resolve({data:{can_review:true,role_name:'technical_reviewer'},error:null})};
   return q;
  },
  async rpc(name:string,args:any) {calls.push({name,args});return {data:error?null:{claim_id:id(4),release_invalidation:{effectiveStatus:'revoked'}},error};},
 };
 const trace:any={source:{ingestion:{id:id(2),status:'processed'}}};
 const request=async(body:any={})=>{
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='test-only-secret';
  const res:any={statusCode:200,body:null,status(n:number){this.statusCode=n;return this;},json(b:any){this.body=b;return this;},setHeader(){}};
  await handleClaim({method:'POST',query:{recordId:id(1)},headers:{authorization:'Bearer test-session'},body:{
    candidate_id:id(5),subject_address:'fixture:amount',claim_type:'SEMANTIC_MAPPING',statement:'Explicit unproven meaning',...body,
  }},res,{createClient:()=>client,getCaseTrace:async()=>trace} as any);
  return res;
 };
 return {calls,request};
}

test('Claim endpoint delegates one transaction and derives identity from the authenticated user',async()=>{
 const {request,calls}=fixture();const res=await request({created_by:id(99),status:'CONFIRMED',evidence_links:[{verification:'VERIFIED'}]});
 assert.equal(res.statusCode,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'bridge_create_explicit_claim');
 assert.equal(calls[0].args.p_actor_id,id(3));assert.equal(calls[0].args.p_snapshot_id,id(2));
 assert.equal(calls[0].args.p_record_id,id(1));assert.equal(res.body.claim_id,id(4));
 assert.equal('status' in calls[0].args,false);assert.equal('evidence_links' in calls[0].args,false);
});

test('missing Claim migration or transactional failure never falls back to writes or cleanup deletes',async()=>{
 for(const error of [{code:'PGRST202',message:'Missing RPC'},{code:'PT409',message:'Candidate changed'},{code:'23514',message:'Audit failed'}]) {
  const {request,calls}=fixture(error);const res=await request();
  assert.equal(res.statusCode,error.code==='PGRST202'?503:error.code==='PT409'?409:500);
  assert.equal(res.body.claim_id,undefined);assert.equal(calls.length,1);
 }
});

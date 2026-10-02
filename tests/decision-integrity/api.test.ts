import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionHandler } from '../../api/cases/[recordId]/decision.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const claimsBasis = 'a'.repeat(64);
function setup(options: { stale?: boolean; claimStale?: boolean; unresolvedSemantic?: boolean; oldClaimsBasis?: boolean; rpcError?: {code:string;message:string}; freshnessRpcError?: {code:string;message:string}; basisRpcError?: {code:string;message:string}; noReviewRole?: boolean } = {}) {
  const calls: Array<{name: string; args: any}> = [];
  const trace: any = {
    source: { ingestion: {id:id(2), status:'processed'} },
    validation: { authoritative: {id:id(3),status:'passed',resolution_record_id:id(4)} },
    review: {current:{complete:true,decision:'approved',reviewer_authorized:true,
      validation_result_id:options.stale?id(90):id(3),resolution_id:id(4),
      session_id:id(5),evidence_reference_ids:[`ingestion:${id(2)}`, ...(options.oldClaimsBasis?[]:[`claims:${claimsBasis}`])]}},
    release: {effective_status:null,certificates:[]},
  };
  const client = {
    auth:{getUser:async()=>({data:{user:{id:id(6)}},error:null})},
    from(table:string) {
      const query: any = {
        select:()=>query,eq:()=>query,maybeSingle:()=>query,
        then(resolve:any) {return Promise.resolve({data:table==='bridge_actor_roles'
          ?{role_name:'reviewer',can_review:!options.noReviewRole,can_release:true,can_revoke:true}
          :table==='claims' && options.unresolvedSemantic
            ?[{id:id(7),claim_type:'SEMANTIC_MAPPING',status:'UNPROVEN',created_at:'2026-09-01T00:00:00Z',subject_address:'NW:A-10266#STATUS'}]
            :[],error:null}).then(resolve);},
      };
      return query;
    },
    async rpc(name:string,args:any) {
      calls.push({name,args});
      if(name==='bridge_claims_after_validation') return {data:options.claimStale??false,error:options.freshnessRpcError??null};
      if(name==='bridge_claims_basis') return {data:claimsBasis,error:options.basisRpcError??null};
      return {data:{},error:options.rpcError??null};
    },
  };
  const handler = createDecisionHandler({createClient:()=>client,getCaseTrace:async()=>trace} as any);
  async function request(method:string,body:any={}) {
    process.env.SUPABASE_URL='https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY='test-only-secret';
    const res:any={statusCode:200,body:null,status(n:number){this.statusCode=n;return this;},json(body:any){this.body=body;return this;},setHeader(){}};
    await handler({method,query:{recordId:id(1)},headers:{authorization:'Bearer test-session'},body},res);
    return res;
  }
  return {request,calls};
}

test('GET hides release when the review references an old validation',async()=>{
 const {request}=setup({stale:true}); const res=await request('GET');
 assert.equal(res.statusCode,200);assert.equal(res.body.access.release_ready,false);
 assert.match(res.body.access.release_blockers.join(' '),/Validierung hat sich geändert/);
});
test('POST rejects stale review before any persistence',async()=>{
 const {request,calls}=setup({stale:true});const res=await request('POST',{action:'release',reason:'Reviewed'});
 assert.equal(res.statusCode,409);assert.equal(calls.some(c=>c.name==='bridge_release_case'),false);
});
test('candidate API delegates one atomic RPC with the verified actor and snapshot',async()=>{
 const {request,calls}=setup();const res=await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Explicit confirmation',actor_id:id(99)});
 assert.equal(res.statusCode,200);const decision=calls.find(c=>c.name==='bridge_decide_candidate');
 assert.ok(decision);assert.equal(decision.args.p_actor_id,id(6));
 assert.equal(decision.args.p_snapshot_id,id(2));assert.equal(decision.args.p_state,'confirmed');
});
test('candidate decision without review rights never invokes the RPC',async()=>{
 const {request,calls}=setup({noReviewRole:true});
 assert.equal((await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Reviewed'})).statusCode,403);
 assert.equal(calls.some(c=>c.name==='bridge_decide_candidate'),false);
});
test('release sends the exact expected basis for the database to recheck',async()=>{
 const {request,calls}=setup();assert.equal((await request('POST',{action:'release',reason:'Explicit release'})).statusCode,200);
 const release=calls.find(c=>c.name==='bridge_release_case');assert.ok(release);
 assert.equal(release.args.p_validation_id,id(3));
 assert.equal(release.args.p_review_session_id,id(5));assert.equal(release.args.p_snapshot_id,id(2));
});
test('later claim blocks review approval and release in the API',async()=>{
 const {request,calls}=setup({claimStale:true});
 const get=await request('GET');assert.equal(get.body.access.review_ready,false);
 assert.equal(get.body.access.release_ready,false);
 assert.match(get.body.access.review_blockers.join(' '),/Neuvalidierung/);
 const review=await request('POST',{action:'approve_review',reason:'Reviewed'});
 assert.equal(review.statusCode,409);
 const release=await request('POST',{action:'release',reason:'Reviewed'});
 assert.equal(release.statusCode,409);
 assert.equal(calls.some(c=>c.name==='bridge_release_case'),false);
});
test('unproven semantic mapping stays blocked after a fresh validation',async()=>{
 const {request,calls}=setup({unresolvedSemantic:true});
 const get=await request('GET'); assert.equal(get.statusCode,200);
 assert.equal(get.body.access.review_ready,false); assert.equal(get.body.access.release_ready,false);
 assert.match(get.body.access.release_blockers.join(' '),/Bedeutungs-Claim/);
 assert.equal((await request('POST',{action:'approve_review',reason:'Reviewed'})).statusCode,409);
 assert.equal((await request('POST',{action:'release',reason:'Reviewed'})).statusCode,409);
 assert.equal(calls.some(c=>c.name==='bridge_release_case'),false);
});
test('missing claim freshness function fails closed',async()=>{
 const {request}=setup({freshnessRpcError:{code:'PGRST202',message:'Function not found'}});
 const res=await request('GET');assert.equal(res.statusCode,503);
});
test('old review without a claim basis cannot be released',async()=>{
 const {request,calls}=setup({oldClaimsBasis:true});
 const get=await request('GET');assert.equal(get.body.access.release_ready,false);
 assert.match(get.body.access.release_blockers.join(' '),/Claim-Basis/);
 const release=await request('POST',{action:'release',reason:'Reviewed'});
 assert.equal(release.statusCode,409);
 assert.equal(calls.some(c=>c.name==='bridge_release_case'),false);
});
test('missing claim basis function fails closed',async()=>{
 const {request}=setup({basisRpcError:{code:'PGRST202',message:'Function not found'}});
 assert.equal((await request('GET')).statusCode,503);
});
test('database race/conflict is surfaced as 409 without a success trace',async()=>{
 const {request}=setup({rpcError:{code:'PT409',message:'Validation changed'}});
 const res=await request('POST',{action:'release',reason:'Reviewed'});
 assert.equal(res.statusCode,409);assert.equal(res.body.trace,undefined);
});
test('missing database migration blocks safely with an actionable 503',async()=>{
 const {request}=setup({rpcError:{code:'PGRST202',message:'Function not found'}});
 const res=await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Reviewed'});
 assert.equal(res.statusCode,503);assert.match(res.body.error,/noch nicht eingerichtet/);
});
test('history/audit failure is not reported as successful',async()=>{
 const {request}=setup({rpcError:{code:'23514',message:'Injected write failure'}});
 const res=await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Reviewed'});
 assert.equal(res.statusCode,500);assert.equal(res.body.trace,undefined);
});

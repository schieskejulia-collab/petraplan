import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionHandler } from '../../api/cases/[recordId]/decision.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup(options: { stale?: boolean; rpcError?: {code:string;message:string}; noReviewRole?: boolean } = {}) {
  const calls: Array<{name: string; args: any}> = [];
  const trace: any = {
    source: { ingestion: {id:id(2), status:'processed'} },
    validation: { authoritative: {id:id(3),status:'passed',resolution_record_id:id(4)} },
    review: {current:{complete:true,decision:'approved',reviewer_authorized:true,
      validation_result_id:options.stale?id(90):id(3),resolution_id:id(4),
      session_id:id(5),evidence_reference_ids:[`ingestion:${id(2)}`]}},
    release: {effective_status:null,certificates:[]},
  };
  const client = {
    auth:{getUser:async()=>({data:{user:{id:id(6)}},error:null})},
    from(table:string) {
      const query: any = {
        select:()=>query,eq:()=>query,maybeSingle:()=>query,
        then(resolve:any) {return Promise.resolve({data:table==='bridge_actor_roles'
          ?{role_name:'reviewer',can_review:!options.noReviewRole,can_release:true,can_revoke:true}
          :[],error:null}).then(resolve);},
      };
      return query;
    },
    async rpc(name:string,args:any) {calls.push({name,args});return {data:{},error:options.rpcError??null};},
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
 assert.equal(res.statusCode,409);assert.equal(calls.length,0);
});
test('candidate API delegates one atomic RPC with the verified actor and snapshot',async()=>{
 const {request,calls}=setup();const res=await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Explicit confirmation',actor_id:id(99)});
 assert.equal(res.statusCode,200);assert.equal(calls.length,1);
 assert.equal(calls[0].name,'bridge_decide_candidate');assert.equal(calls[0].args.p_actor_id,id(6));
 assert.equal(calls[0].args.p_snapshot_id,id(2));assert.equal(calls[0].args.p_state,'confirmed');
});
test('candidate decision without review rights never invokes the RPC',async()=>{
 const {request,calls}=setup({noReviewRole:true});
 assert.equal((await request('POST',{action:'confirm_candidate',candidate_id:id(7),reason:'Reviewed'})).statusCode,403);
 assert.equal(calls.length,0);
});
test('release sends the exact expected basis for the database to recheck',async()=>{
 const {request,calls}=setup();assert.equal((await request('POST',{action:'release',reason:'Explicit release'})).statusCode,200);
 assert.equal(calls[0].name,'bridge_release_case');assert.equal(calls[0].args.p_validation_id,id(3));
 assert.equal(calls[0].args.p_review_session_id,id(5));assert.equal(calls[0].args.p_snapshot_id,id(2));
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSemanticRules } from '../../api/cases/[recordId]/semantic-rules.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const definition = { question:'A clear question',condition:'A clear condition',conclusion:'A clear conclusion',justification:'A documented reason',
  evidence:[],limitations:[],exceptions:[],unresolved_items:['Meaning is not yet established'] };
function setup(options: { authorized?: boolean; authenticated?: boolean; rpcError?: any; missingSchema?: boolean } = {}) {
  const calls: Array<{ name:string;args:any }> = [];
  const client = {
    auth:{getUser:async()=>({data:{user:options.authenticated===false?null:{id:id(2)}},error:null})},
    from(table:string) {
      const query:any={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,maybeSingle:()=>query,
        then(resolve:any) {
          const data = table==='bridge_actor_roles'?{active:true,can_review:options.authorized!==false}
            :table==='records'?{id:id(1),ingestion_log_id:id(3)}
            :table==='semantic_rule_versions'?[{id:id(4),snapshot_id:id(3),target_address:'case#STATUS'}]
            :table==='semantic_rule_decisions'?[{rule_version_id:id(4),decision:'REJECTED',sequence:1}]
            :table==='semantic_rule_authorities'?[{id:id(5),user_id:id(2),snapshot_id:id(3),target_address:'case#STATUS',granted_at:'2026-01-01',valid_until:'2099-01-01'}]:[];
          return Promise.resolve({data,error:options.missingSchema&&table==='semantic_rule_versions'?{code:'42P01'}:null}).then(resolve);
        }};
      return query;
    },
    async rpc(name:string,args:any){calls.push({name,args});return {data:{id:id(4)},error:options.rpcError??null};},
  };
  async function request(method='POST',body:any={}) {
    const res:any={statusCode:200,body:null,setHeader(){},status(n:number){this.statusCode=n;return this;},json(body:any){this.body=body;return this;}};
    const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='test-only';
    try { await handleSemanticRules({method,query:{recordId:id(1)},headers:{authorization:'Bearer test-only'},body},res,{createClient:()=>client} as any); }
    finally {
      if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
      if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;
    }
    return res;
  }
  return {request,calls};
}
test('proposal delegates one atomic RPC with the authenticated actor',async()=>{
  const {request,calls}=setup(); const res=await request('POST',{action:'propose',claim_id:id(6),actor_id:id(99),definition});
  assert.equal(res.statusCode,201);assert.equal(calls.length,1);
  assert.equal(calls[0].name,'bridge_propose_semantic_rule');assert.equal(calls[0].args.p_actor_id,id(2));
  assert.equal(calls[0].args.p_record_id,id(1));assert.deepEqual(calls[0].args.p_definition,definition);
});
test('approval sends version and authority for database rechecking, never client actor',async()=>{
  const {request,calls}=setup(); const res=await request('POST',{action:'approve',rule_version_id:id(4),authority_id:id(5),actor_id:id(99),reason:'Reviewed semantic evidence',criteria:{meaning_evidence_checked:true}});
  assert.equal(res.statusCode,200);assert.equal(calls[0].name,'bridge_decide_semantic_rule');
  assert.equal(calls[0].args.p_actor_id,id(2));assert.equal(calls[0].args.p_authority_id,id(5));assert.equal(calls[0].args.p_decision,'APPROVED');
});
test('GET projects proposal history and only the matching current-user scope authority',async()=>{
  const {request}=setup();const res=await request('GET');assert.equal(res.statusCode,200);
  assert.equal(res.body.rules[0].status,'REJECTED');assert.equal(res.body.rules[0].decision_authority.id,id(5));
  assert.equal(res.body.claim_confirmation_automatic,false);
});
test('authentication and technical review permission are required before rule mutations',async()=>{
  for(const [options,status] of [[{authenticated:false},401],[{authorized:false},403]] as const){
    const {request,calls}=setup(options);assert.equal((await request('POST',{action:'propose',claim_id:id(6),definition})).statusCode,status);assert.deepEqual(calls,[]);
  }
});
test('invalid proposal, missing authority, and authority self-assignment actions are rejected',async()=>{
  const {request,calls}=setup();
  assert.equal((await request('POST',{action:'propose',claim_id:id(6),definition:{...definition,condition:''}})).statusCode,400);
  assert.equal((await request('POST',{action:'approve',rule_version_id:id(4),reason:'A long reason'})).statusCode,400);
  assert.equal((await request('POST',{action:'grant_authority',user_id:id(2)})).statusCode,400);
  assert.deepEqual(calls,[]);
});
test('database role or lifecycle rejection is propagated without a successful result',async()=>{
  const {request}=setup({rpcError:{code:'PT403',message:'No documented semantic authority'}});
  const res=await request('POST',{action:'approve',rule_version_id:id(4),authority_id:id(5),reason:'A long reason'});
  assert.equal(res.statusCode,403);assert.equal(res.body.decision,undefined);
});
test('missing migration returns a visible readiness error rather than an empty catalogue',async()=>{
  const {request}=setup({missingSchema:true});const res=await request('GET');assert.equal(res.statusCode,503);assert.equal(res.body.rules,undefined);
});

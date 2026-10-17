import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleClaimChecks } from '../../api/cases/[recordId]/claim-checks.js';
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
            :table==='claim_check_requirements'?[]
            :table==='semantic_rule_decisions'?[{rule_version_id:id(4),decision:'REJECTED',sequence:1}]
            :table==='semantic_rule_authorities'?[{id:id(5),user_id:id(2),snapshot_id:id(3),target_address:'case#STATUS',granted_at:'2026-01-01',valid_until:'2099-01-01'}]:[];
          return Promise.resolve({data,error:options.missingSchema&&table==='claim_check_requirements'?{code:'42P01'}:null}).then(resolve);
        }};
      return query;
    },
    async rpc(name:string,args:any){calls.push({name,args});return {data:{id:id(4)},error:options.rpcError??null};},
  };
  async function request(method='POST',body:any={}) {
    const res:any={statusCode:200,body:null,setHeader(){},status(n:number){this.statusCode=n;return this;},json(body:any){this.body=body;return this;}};
    const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SECRET_KEY='test-only';
    try { await handleClaimChecks({method,query:{recordId:id(1)},headers:{authorization:'Bearer test-only'},body},res,{createClient:()=>client} as any); }
    finally {
      if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
      if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;
    }
    return res;
  }
  return {request,calls};
}
const checkDefinition={question:'Is this order closed?',required_information:'Remaining delivery quantity',required_address:'case#Remaining',check_condition:'No remaining deliveries',counter_condition:'There is a remaining delivery',coverage_requirement:'The entire export is included',next_check:'Read complete delivery data'};
test('check creation uses authenticated actor and one atomic RPC',async()=>{const {request,calls}=setup();const res=await request('POST',{action:'add',claim_id:id(6),actor_id:id(99),definition:checkDefinition});assert.equal(res.statusCode,201);assert.equal(calls[0].name,'bridge_add_claim_check');assert.equal(calls[0].args.p_actor_id,id(2));assert.deepEqual(calls[0].args.p_definition,checkDefinition);});
test('report delegates exact case/evidence and cannot confirm a Claim',async()=>{const {request,calls}=setup();const res=await request('POST',{action:'record',requirement_id:id(4),observation:{result:'UNKNOWN',coverage_status:'UNKNOWN',reason:'Meaning not yet established'}});assert.equal(res.statusCode,201);assert.equal(calls[0].name,'bridge_record_claim_check');assert.equal(res.body.claim_confirmation_automatic,false);});
test('empty plan is explicitly planning-only, not a passed validation',async()=>{const {request}=setup();const res=await request('GET');assert.equal(res.statusCode,200);assert.equal(res.body.planning_only,true);assert.deepEqual(res.body.requirements,[]);});
test('unauthenticated and unauthorized users never reach mutation RPC',async()=>{for(const [options,status] of [[{authenticated:false},401],[{authorized:false},403]] as const){const {request,calls}=setup(options);assert.equal((await request('POST',{action:'add',claim_id:id(6),definition:checkDefinition})).statusCode,status);assert.deepEqual(calls,[]);}});
test('invalid definition and invented result cannot be persisted',async()=>{const {request,calls}=setup();assert.equal((await request('POST',{action:'add',claim_id:id(6),definition:{...checkDefinition,counter_condition:''}})).statusCode,400);assert.equal((await request('POST',{action:'record',requirement_id:id(4),observation:{result:'ACCEPTED',coverage_status:'COMPLETE',reason:'A long reason'}})).statusCode,400);assert.deepEqual(calls,[]);});
test('stale database basis and missing migration are visibly blocked',async()=>{let x=setup({rpcError:{code:'PT409',message:'Changed basis'}});assert.equal((await x.request('POST',{action:'add',claim_id:id(6),definition:checkDefinition})).statusCode,409);x=setup({missingSchema:true});assert.equal((await x.request('GET')).statusCode,503);});

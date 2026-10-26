import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceRelationalPrerequisites,inspectObservedChain, type SchemaShape} from './relationalChain.js';

test('the SAP exercise yields a chain of explicitly paired composite references, not a value or meaning',()=>{
 const schema:SchemaShape={tables:[
  {name:'ZKUNDEN',key:['MANDT','KUNDENNR'],fields:['MANDT','KUNDENNR','NAME']},
  {name:'ZDEPOT',key:['MANDT','DEPOTNR'],fields:['MANDT','DEPOTNR','KUNDENNR']},
  {name:'ZDEPOTPSTN',key:['MANDT','DEPOTNR','WKN'],fields:['MANDT','DEPOTNR','WKN','ANZAHL']},
  {name:'ZWPAPIER',key:['MANDT','WKN'],fields:['MANDT','WKN','TITEL']},
  {name:'ZKURSE',key:['MANDT','WKN','DATUM'],fields:['MANDT','WKN','DATUM','KURS']},
 ],references:[
  {child:'ZDEPOT',parent:'ZKUNDEN',pairs:[{childField:'MANDT',parentField:'MANDT'},{childField:'KUNDENNR',parentField:'KUNDENNR'}]},
  {child:'ZDEPOTPSTN',parent:'ZDEPOT',pairs:[{childField:'MANDT',parentField:'MANDT'},{childField:'DEPOTNR',parentField:'DEPOTNR'}]},
  {child:'ZDEPOTPSTN',parent:'ZWPAPIER',pairs:[{childField:'MANDT',parentField:'MANDT'},{childField:'WKN',parentField:'WKN'}]},
  {child:'ZKURSE',parent:'ZWPAPIER',pairs:[{childField:'MANDT',parentField:'MANDT'},{childField:'WKN',parentField:'WKN'}]},
 ]};
 const [course]=traceRelationalPrerequisites(schema,'ZKUNDEN',['ZKURSE']);
 assert.deepEqual(course.gaps,[]);
 assert.deepEqual(course.paths[0].map(s=>s.to),['ZDEPOT','ZDEPOTPSTN','ZWPAPIER','ZKURSE']);
 assert.deepEqual(course.paths[0][0].pairs,[{fromField:'MANDT',toField:'MANDT'},{fromField:'KUNDENNR',toField:'KUNDENNR'}]);
 assert.equal(course.structural_only,true);
 const observed=inspectObservedChain(course.paths[0],{MANDT:'100',KUNDENNR:'7',NAME:'Müller'}, {
  ZDEPOT:[{MANDT:'100',DEPOTNR:'D1',KUNDENNR:'7'},{MANDT:'200',DEPOTNR:'D2',KUNDENNR:'7'}],
  ZDEPOTPSTN:[{MANDT:'100',DEPOTNR:'D1',WKN:'W1',ANZAHL:3}],
  ZWPAPIER:[{MANDT:'100',WKN:'W1',TITEL:'Beispiel'}],
  ZKURSE:[{MANDT:'100',WKN:'W1',DATUM:'2026-10-26',KURS:2}],
 });
 assert.deepEqual(observed.gaps,[]);
 assert.equal(observed.levels.at(-1)?.[0].KURS,2);
 assert.equal(observed.semantic_confirmation,false);
 const missing=inspectObservedChain(course.paths[0],{MANDT:'100',KUNDENNR:'7'}, {
  ZDEPOT:[{MANDT:'100',DEPOTNR:'D1',KUNDENNR:'7'}],ZDEPOTPSTN:[{MANDT:'100',DEPOTNR:'D1',ANZAHL:3}],
 });
 assert.equal(missing.gaps[0].kind,'MISSING_JOIN_VALUE');
 assert.equal(missing.levels.at(-1)?.length,0);
 const [broken]=traceRelationalPrerequisites({...schema,references:schema.references.filter(r=>r.child!=='ZDEPOT')},'ZKUNDEN',['ZKURSE']);
 assert.equal(broken.gaps[0].kind,'NO_DECLARED_PATH');
});

test('an unrelated order schema exposes incomplete keys rather than guessing a join',()=>{
 const tables=[{name:'orders',key:['tenant','id'],fields:['tenant','id']},{name:'lines',key:['tenant','order_id','line'],fields:['tenant','order_id','line']},{name:'receipts',key:['tenant','id'],fields:['tenant','id','order_id']}];
 const ref={child:'lines',parent:'orders',pairs:[{childField:'tenant',parentField:'tenant'},{childField:'order_id',parentField:'id'}]};
 const schema:SchemaShape={tables,references:[ref,{child:'receipts',parent:'orders',pairs:[{childField:'order_id',parentField:'id'}]}]};
 assert.equal(traceRelationalPrerequisites(schema,'lines',['receipts'])[0].gaps[0].kind,'INCOMPLETE_REFERENCE');
 const complete={child:'receipts',parent:'orders',pairs:[{childField:'tenant',parentField:'tenant'},{childField:'order_id',parentField:'id'}]};
 assert.deepEqual(traceRelationalPrerequisites({...schema,references:[ref,complete]},'lines',['receipts'])[0].gaps,[]);
});

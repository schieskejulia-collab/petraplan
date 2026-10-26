/** A schema declaration is a proposal about structure, never evidence that rows
 * exist or that a business interpretation of their values has been confirmed. */
export type TableShape = {name:string; key:string[]; fields:string[]};
export type ReferenceShape = {child:string; parent:string; pairs:Array<{childField:string;parentField:string}>};
export type SchemaShape = {tables:TableShape[]; references:ReferenceShape[]};
export type ChainStep = {from:string;to:string;via:string; pairs:Array<{fromField:string;toField:string}>};
export type ChainGap = {kind:'UNKNOWN_TABLE'|'NO_DECLARED_PATH'|'INCOMPLETE_REFERENCE'|'AMBIGUOUS_PATH';detail:string};

/** Work backwards from an intended table to each declared prerequisite table.
 * Traversal is bidirectional, but field assignments are never inferred from names. */
export function traceRelationalPrerequisites(schema:SchemaShape, resultTable:string, requiredTables:string[]) {
 const tables=new Map(schema.tables.map(t=>[t.name,t]));
 const invalid=new Set<ReferenceShape>();
 for(const ref of schema.references) {
  const child=tables.get(ref.child),parent=tables.get(ref.parent);
  if(!child || !parent || ref.pairs.length===0 || new Set(ref.pairs.map(p=>p.parentField)).size!==parent.key.length
    || new Set(ref.pairs.map(p=>p.childField)).size!==ref.pairs.length
    || parent.key.some(k=>!ref.pairs.some(p=>p.parentField===k))
    || ref.pairs.some(p=>!child.fields.includes(p.childField)||!parent.fields.includes(p.parentField))) invalid.add(ref);
 }
 return requiredTables.map(requiredTable=>{
  const gaps:ChainGap[]=[];
  if(!tables.has(resultTable)||!tables.has(requiredTable)) gaps.push({kind:'UNKNOWN_TABLE',detail:!tables.has(resultTable)?resultTable:requiredTable});
  if(gaps.length) return {resultTable,requiredTable,paths:[] as ChainStep[][],gaps,structural_only:true};
  const paths:ChainStep[][]=[];
  const walk=(at:string,seen:Set<string>,steps:ChainStep[],allowInvalid:boolean,result:ChainStep[][])=>{
   if(at===requiredTable){result.push(steps);return;}
   for(const ref of schema.references) {
    if(invalid.has(ref) && !allowInvalid)continue;
    if(at!==ref.child && at!==ref.parent)continue;
    const next=at===ref.child?ref.parent:ref.child;
    if(seen.has(next))continue;
    const pairs=ref.pairs.map(p=>at===ref.child
     ? {fromField:p.childField,toField:p.parentField}
     : {fromField:p.parentField,toField:p.childField});
    walk(next,new Set([...seen,next]),[...steps,{from:at,to:next,via:`${ref.child}->${ref.parent}`,pairs}],allowInvalid,result);
   }
  };
  walk(resultTable,new Set([resultTable]),[],false,paths);
  if(paths.length===0){
   const proposed:ChainStep[][]=[];
   walk(resultTable,new Set([resultTable]),[],true,proposed);
   gaps.push({kind:proposed.length>0?'INCOMPLETE_REFERENCE':'NO_DECLARED_PATH',detail:`${resultTable} -> ${requiredTable}`});
  }
  if(paths.length>1) gaps.push({kind:'AMBIGUOUS_PATH',detail:`${paths.length} declared paths; choose the intended relationship explicitly`});
  return {resultTable,requiredTable,paths,gaps,structural_only:true};
 });
}

/** Inspect a supplied, bounded observation snapshot along one declared path.
 * An absent match means not observed in this snapshot, never proven nonexistent. */
export function inspectObservedChain(path:ChainStep[], start:Record<string,unknown>, rows:Record<string,Array<Record<string,unknown>>>) {
 let current=[start];
 const gaps:Array<{step:number;kind:'MISSING_JOIN_VALUE'|'NO_OBSERVED_MATCH'|'NON_UNIQUE_PARENT';from:string;to:string}>=[];
 const levels=[current];
 path.forEach((step,index)=>{
  const next:Array<Record<string,unknown>>=[];
  for(const source of current){
   if(step.pairs.some(pair=>source[pair.fromField]===undefined || source[pair.fromField]===null)){
    gaps.push({step:index,kind:'MISSING_JOIN_VALUE',from:step.from,to:step.to});continue;
   }
   const matches=(rows[step.to]??[]).filter(target=>step.pairs.every(pair=>
    target[pair.toField]!==undefined && target[pair.toField]!==null && Object.is(source[pair.fromField],target[pair.toField])));
   if(matches.length===0)gaps.push({step:index,kind:'NO_OBSERVED_MATCH',from:step.from,to:step.to});
   const [child,parent]=step.via.split('->');
   if(step.from===child && step.to===parent && matches.length>1)gaps.push({step:index,kind:'NON_UNIQUE_PARENT',from:step.from,to:step.to});
   next.push(...matches);
  }
  current=next;
  levels.push(current);
 });
 return {levels,gaps,observed_only:true,semantic_confirmation:false};
}

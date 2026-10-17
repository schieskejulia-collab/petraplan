function canonical(value: any): string | undefined {
 if (value === undefined) return undefined;
 const sort = (v:any):any => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key=>[key,sort(v[key])])) : v;
 return JSON.stringify(sort(value));
}
/** Read-only planning: reviewer reports never promote a Claim or authorize action. */
export function buildClaimCheckPlan(requirements: any[], observations: any[], evidence: any[], bases: Record<string,string>, snapshotId: string) {
 const replaced = new Set(requirements.map(r => r.previous_requirement_id).filter(Boolean));
 return requirements.map(r => {
  const history = observations.filter(o => o.requirement_id === r.id).sort((a,b) => Number(a.sequence)-Number(b.sequence));
  const latest = history.at(-1) ?? null;
  const matches = evidence.filter(e => e.record_id === r.record_id && e.ingestion_log_id === r.snapshot_id && e.field_address === r.required_address);
  const used = latest?.representation_evidence_id ? evidence.find(e => e.id === latest.representation_evidence_id) : null;
  const evidenceStale = Boolean(latest?.representation_evidence_id && (!used || !latest.evidence_snapshot
   || Object.keys(latest.evidence_snapshot).some(key => canonical(latest.evidence_snapshot[key]) !== canonical(used[key]))));
  const stale = (latest?.result === 'MISSING' && matches.length > 0) || evidenceStale || r.snapshot_id !== snapshotId || !bases[r.claim_id] || bases[r.claim_id] !== r.claim_basis;
  const superseded = replaced.has(r.id);
  const status = superseded ? 'SUPERSEDED' : stale ? 'STALE' : latest?.result ?? 'UNASSESSED';
  // Having a value is not having evaluated its meaning. Zero/null are not missing evidence.
  const next = superseded ? null : stale ? 'Prüfanforderung auf der aktuellen Claim-Grundlage neu anlegen.'
   : status === 'CONTRADICTS' ? 'Gegenbeleg fachlich prüfen; Claim bleibt bis zur Entscheidung unverändert.'
   : status === 'SUPPORTS' ? 'Prüfbericht und Vollständigkeitsbeleg fachlich verifizieren; keine automatische Freigabe.' : r.next_check;
  return {...r,status,history,latest_observation:latest,available_evidence_ids:matches.map(e=>e.id),
   evidence_available:matches.length>0,next_check_pending:next,acceptance_automatic:false};
 });
}

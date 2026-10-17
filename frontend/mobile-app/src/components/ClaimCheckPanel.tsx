import {useEffect,useState} from 'react';
import {CLAIM_CHECK_TEMPLATES} from '@/lib/claim-check-templates';
import {currentAccessToken} from '@/lib/bridge-auth';
type Requirement = {id:string;claim_id:string;question:string;required_information:string;required_address:string;check_condition:string;counter_condition:string;coverage_requirement:string;next_check:string;status:string;next_check_pending:string|null;available_evidence_ids:string[];history:Array<{id:string;result:string;reason:string;recorded_at:string;recorded_by:string;coverage_status:string;coverage_reference:string|null;representation_evidence_id:string|null;evidence_snapshot:unknown}>};
type Evidence = {id:string;field_address:string;source_path:string;raw_representation:unknown;evidence_hash:string;ingestion_log_id:string};
const fields = [['question','Prüffrage'],['required_information','Benötigte Information'],['required_address','Fundstelle / Feldadresse'],['check_condition','Was würde die Aussage stützen?'],['counter_condition','Was würde ihr widersprechen?'],['coverage_requirement','Was muss vollständig vorliegen?'],['next_check','Nächster Prüfschritt']] as const;
const empty=()=>Object.fromEntries(fields.map(([key])=>[key,''])) as Record<string,string>;
const labels:Record<string,string>={UNASSESSED:'Noch nicht geprüft',MISSING:'Information fehlt',UNKNOWN:'Ungeklärt',SUPPORTS:'Als stützend berichtet',CONTRADICTS:'Als widersprechend berichtet',STALE:'Grundlage verändert',SUPERSEDED:'Ersetzt'};
async function request(recordId:string,body?:Record<string,unknown>) {
 const token=await currentAccessToken();if(!token)throw new Error('Bitte anmelden.');
 const res=await fetch(`/api/cases/${encodeURIComponent(recordId)}/claim-checks`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json();if(!res.ok)throw new Error(data.error??`HTTP ${res.status}`);return data;
}
export function ClaimCheckPanel({recordId,claims}:{recordId:string;claims:Array<Record<string,unknown>>}) {
 const [requirements,setRequirements]=useState<Requirement[]>([]),[evidence,setEvidence]=useState<Evidence[]>([]);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [claimId,setClaimId]=useState(''),[previous,setPrevious]=useState<string|null>(null),[draft,setDraft]=useState(empty);
 const [templateId,setTemplateId]=useState('');
 const template=CLAIM_CHECK_TEMPLATES.find(t=>t.id===templateId);
 const [reports,setReports]=useState<Record<string,Record<string,string>>>({});
 useEffect(()=>{let active=true;void request(recordId).then(data=>{if(active){setRequirements(data.requirements);setEvidence(data.evidence);setReady(true);}}).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};},[recordId]);
 const save=async(body:Record<string,unknown>)=>{setBusy(true);setError('');try{await request(recordId,body);const data=await request(recordId);setRequirements(data.requirements);setEvidence(data.evidence);if(body.action==='add'){setDraft(empty());setPrevious(null);setClaimId('');}setReports({});}catch(err){setError(err instanceof Error?err.message:'Prüfung konnte nicht gespeichert werden.');}finally{setBusy(false);}};
 const report=(id:string)=>reports[id]??{result:'UNKNOWN',coverage_status:'UNKNOWN',coverage_reference:'',representation_evidence_id:'',reason:''};
 const update=(id:string,key:string,value:string)=>setReports(old=>({...old,[id]:{...report(id),[key]:value}}));
 return <section className="bridge-proof-form mb-4 rounded-xl border p-4 space-y-4">
  <h2 className="font-semibold">Benötigte Belege und Gegenprüfungen</h2>
  <p>Welche Information fehlt? Was könnte der Aussage widersprechen? Prüfberichte bestätigen keinen Claim und erteilen keine Freigabe.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {!ready&&!error&&<p>Lade Prüfanforderungen …</p>}
  {ready&&<>
   {requirements.length===0&&<p>Noch keine Prüfanforderungen hinterlegt. Das bedeutet nicht, dass alle Voraussetzungen geprüft sind.</p>}
   {requirements.map(r=><article key={r.id} className="border rounded-lg p-3 space-y-2">
    <h3 className="font-semibold">{r.question}</h3><p>{labels[r.status]??r.status}</p>
    <p>Benötigt: {r.required_information}</p><p className="break-all">Fundstelle: {r.required_address}</p>
    <p>Stützend: {r.check_condition}</p><p>Widersprechend: {r.counter_condition}</p><p>Vollständigkeit: {r.coverage_requirement}</p>
    <p>Fehlende Daten bleiben ungeklärt.</p>{r.next_check_pending&&<p>Nächster Schritt: {r.next_check_pending}</p>}
    {evidence.filter(e=>r.available_evidence_ids.includes(e.id)).map(e=><details key={e.id}><summary>Quellbeleg {e.id}</summary><p className="break-all">{e.source_path} · Snapshot {e.ingestion_log_id}</p><pre className="overflow-auto">{JSON.stringify(e.raw_representation,null,2)}</pre><p className="break-all">Hash: {e.evidence_hash}</p></details>)}
    <details><summary>Prüfhistorie ({r.history.length})</summary>{r.history.map(o=><div key={o.id}><p>{labels[o.result]} · {o.recorded_at} · {o.recorded_by}: {o.reason} · Vollständigkeit {o.coverage_status} · {o.coverage_reference??'kein Vollständigkeitsbeleg'} · Quellbeleg {o.representation_evidence_id??'keiner'}</p>{o.evidence_snapshot!=null&&<details><summary>Bei dieser Prüfung verwendete Belegfassung</summary><pre className="overflow-auto">{JSON.stringify(o.evidence_snapshot,null,2)}</pre></details>}</div>)}</details>
    {!['STALE','SUPERSEDED'].includes(r.status)&&<fieldset disabled={busy} className="space-y-2">
     <legend>Prüfbericht erfassen</legend>
     <label className="block">Ergebnis <select value={report(r.id).result} onChange={e=>update(r.id,'result',e.target.value)}>{['UNKNOWN','MISSING','SUPPORTS','CONTRADICTS'].map(x=><option key={x} value={x}>{labels[x]}</option>)}</select></label>
     <label className="block">Quellbeleg <select value={report(r.id).representation_evidence_id} onChange={e=>update(r.id,'representation_evidence_id',e.target.value)}><option value="">Kein Beleg</option>{r.available_evidence_ids.map(id=><option key={id}>{id}</option>)}</select></label>
     <label className="block">Vollständigkeit <select value={report(r.id).coverage_status} onChange={e=>update(r.id,'coverage_status',e.target.value)}><option value="UNKNOWN">Ungeklärt</option><option value="INCOMPLETE">Unvollständig</option><option value="COMPLETE">Vollständig laut Beleg</option></select></label>
     <label className="block">Vollständigkeitsbeleg <input className="w-full border rounded p-2" value={report(r.id).coverage_reference} onChange={e=>update(r.id,'coverage_reference',e.target.value)}/></label>
     <label className="block">Begründung <textarea className="w-full border rounded p-2" value={report(r.id).reason} onChange={e=>update(r.id,'reason',e.target.value)}/></label>
     <button type="button" disabled={report(r.id).reason.trim().length<8} onClick={()=>void save({action:'record',requirement_id:r.id,observation:{...report(r.id),representation_evidence_id:report(r.id).representation_evidence_id||null}})}>Prüfbericht speichern</button>
    </fieldset>}
    {r.status!=='SUPERSEDED'&&<button type="button" disabled={busy} onClick={()=>{setClaimId(r.claim_id);setPrevious(r.id);setDraft(Object.fromEntries(fields.map(([key])=>[key,r[key]])));}}>Neue Fassung vorbereiten</button>}
   </article>)}
   <form onSubmit={e=>{e.preventDefault();void save({action:'add',claim_id:claimId,previous_requirement_id:previous,definition:draft});}} className="space-y-3">
    <fieldset disabled={busy} className="space-y-3"><legend>{previous?'Neue Fassung':'Prüfanforderung anlegen'}</legend>
     <label className="block">Prüfvorlage <select value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">Eigene Prüfanforderung</option>{CLAIM_CHECK_TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
     {template&&<div className="space-y-2"><p>Vorlagenquelle: {template.source}. Daraus abgeleitete Prüffragen; noch kein Beleg für diesen Fall.</p><p>{template.fundstelleHint}</p><p>Jede benötigte Fundstelle separat prüfen. Die konkrete Feldadresse bleibt von dir zu ergänzen.</p><button type="button" onClick={()=>setDraft({...template.definition})}>Vorlage in die Eingabefelder übernehmen</button><p>Übernehmen ersetzt die Texte im aktuellen Entwurf. Gespeicherte Prüfungen bleiben erhalten.</p></div>}
     <label className="block">Aussage <select required value={claimId} disabled={previous!==null} onChange={e=>setClaimId(e.target.value)}><option value="">Claim wählen</option>{claims.filter(c=>!['REJECTED','SUPERSEDED'].includes(String(c.status))).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.statement)}</option>)}</select></label>
     {fields.map(([key,label])=><label className="block" key={key}>{label}<textarea required minLength={key==='required_address'?1:8} className="w-full border rounded p-2" value={draft[key]} onChange={e=>setDraft(old=>({...old,[key]:e.target.value}))}/></label>)}
     <button type="submit" disabled={!claimId}>Prüfanforderung speichern</button>
     {previous&&<button type="button" onClick={()=>{setPrevious(null);setDraft(empty());setClaimId('');}}>Neue Fassung abbrechen</button>}
    </fieldset>
   </form>
  </>}
 </section>;
}

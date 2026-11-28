import {useEffect,useState} from 'react';
import {submitBridgeDecision} from '@/lib/bridge-decision-client';
import {currentAccessToken} from '@/lib/bridge-auth';
import {parseInvoiceDuplicates} from '@/lib/invoice-duplicates-client';
export default function InvoiceDuplicateDecision({recordId,snapshotId,onChanged}:{recordId:string;snapshotId:string;onChanged:()=>void}){
 const [basis,setBasis]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState(''),[reference,setReference]=useState(''),[reload,setReload]=useState(0);
 async function request(method='GET',body?:any){
  const token=await currentAccessToken();if(!token)throw Error('Bitte anmelden.');
  const response=await fetch(`/api/cases/${encodeURIComponent(recordId)}/invoice-duplicate-decision?snapshotId=${encodeURIComponent(snapshotId)}`,{
   method,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error??'Prüfentscheidung nicht verfügbar.');return data;
 }
 useEffect(()=>{let active=true;setBasis(null);setError('');request().then(data=>{
  if(data.contract!=='invoice-duplicate-decision-v1'||typeof data.corpusHash!=='string'||!/^[a-f0-9]{64}$/.test(data.corpusHash))throw Error('Ungültige Entscheidungsgrundlage.');
  parseInvoiceDuplicates(data.comparison,recordId,snapshotId);if(active)setBasis(data);
 }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[recordId,snapshotId,reload]);
 async function decide(action:string){setBusy(true);setError('');try{await request('POST',{action,corpusHash:basis.corpusHash,reason,evidenceReference:reference});setReload(x=>x+1);await onChanged();}catch(e){setError(e instanceof Error?e.message:'Entscheidung fehlgeschlagen.');}finally{setBusy(false);}}
 async function revoke(){setBusy(true);setError('');try{const token=await currentAccessToken();if(!token)throw Error('Bitte anmelden.');await submitBridgeDecision({recordId,action:'revoke',reason,token});setReload(x=>x+1);await onChanged();}catch(e){setError(e instanceof Error?e.message:'Widerruf fehlgeschlagen.');}finally{setBusy(false);}}
 const complete=basis&&basis.comparison.coverage.unusableBasis===0&&basis.comparison.coverage.incompleteSignals===0&&!basis.comparison.coverage.scanTruncated&&!basis.comparison.coverage.findingsTruncated;
 const enabled=!busy&&reason.trim().length>=8&&reference.trim().length>=3;
 return <section aria-label="Verbindliche Dublettenentscheidung" className="space-y-3 rounded border p-3 text-sm">
  <h3 className="font-semibold">Verbindliche Dublettenentscheidung</h3>
  <p>Diese Entscheidung erzeugt kein Zertifikat. Review und Freigabe bleiben gesonderte Schritte. Neue oder geänderte Rechnungsfälle erfordern eine erneute Prüfung.</p>
  {error&&<p role="status">{error}</p>}
  {basis&&<>
   <p>{basis.decision?`Aktuelle Entscheidung: ${basis.decision.action}`:'Noch keine aktuelle Entscheidung zum geprüften Bestand.'}</p>
   {!complete&&<p>Unvollständige Vergleichsgrundlage: Freigabe bleibt gesperrt.</p>}
   <label className="block">Beleg der Dublettenprüfung<input className="block w-full rounded border p-2" value={reference} maxLength={2000} onChange={e=>setReference(e.target.value)}/></label>
   <label className="block">Begründung der Dublettenentscheidung<textarea className="block w-full rounded border p-2" value={reason} maxLength={4000} onChange={e=>setReason(e.target.value)}/></label>
   <div className="flex flex-wrap gap-2">
    {basis.canRevoke&&<button className="rounded border p-2" disabled={busy||reason.trim().length<8} onClick={()=>void revoke()}>Frühere Freigabe widerrufen</button>}
    <button className="rounded border p-2" disabled={!enabled||!complete||basis.comparison.findingCount!==0} onClick={()=>decide('CLEAR')}>Prüfung ohne Verdacht bestätigen</button>
    <button className="rounded border p-2" disabled={!enabled} onClick={()=>decide('DUPLICATE')}>Als Doppelrechnung sperren</button>
    <button className="rounded border p-2" disabled={!enabled} onClick={()=>decide('HOLD')}>Zur Klärung sperren</button>
    {basis.canAdjudicate&&<>
     <button className="rounded border p-2" disabled={!enabled||!complete||basis.comparison.findingCount===0||basis.comparison.findings.some((f:any)=>f.code==='IDENTICAL_XML')} onClick={()=>decide('DISTINCT')}>Eigenständigen Vorgang belegt bestätigen</button>
     <button className="rounded border p-2" disabled={!enabled||!complete||basis.comparison.findingCount===0||basis.blockedCopyCount!==basis.comparison.findingCount} onClick={()=>decide('PRIMARY')}>Referenzfassung bei gesperrten Kopien bestätigen</button>
    </>}
   </div>
   <button className="underline" disabled={busy} onClick={()=>setReload(x=>x+1)}>Entscheidungsgrundlage neu laden</button>
  </>}
 </section>;
}

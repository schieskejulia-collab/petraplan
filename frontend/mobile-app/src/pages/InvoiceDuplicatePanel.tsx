import { useEffect,useState } from 'react';
import { currentAccessToken } from '@/lib/bridge-auth';
import { fetchInvoiceDuplicates,type InvoiceDuplicateResult } from '@/lib/invoice-duplicates-client';

const labels={IDENTICAL_XML:'Gleiche XML-Originalbytes',SAME_REPORTED_IDENTITY:'Gleiche erklärte Rechnungsidentität',
 SIMILAR_CONTENT:'Ähnliche Rechnung, Nummer kann abweichen',SIMILAR_CONTENT_WEAK_PARTIES:'Ähnliche Inhalte, Parteienkennungen fehlen'};
export default function InvoiceDuplicatePanel({recordId,snapshotId}:{recordId:string;snapshotId:string}){
 const [result,setResult]=useState<InvoiceDuplicateResult|null>(null),[error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setResult(null);setError(null);
  (async()=>{const token=await currentAccessToken();if(!token)throw Error('Bitte erneut anmelden.');
   const value=await fetchInvoiceDuplicates(recordId,snapshotId,token);if(active)setResult(value);
  })().catch(e=>{if(active)setError(e instanceof Error?e.message:'Vergleich nicht verfügbar.');})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[recordId,snapshotId,revision]);
 return <section aria-label="Dublettenhinweise" className="space-y-3 rounded-lg border p-3 text-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Dublettenhinweise</h3>
   <button className="rounded border px-2 py-1" disabled={loading} onClick={()=>setRevision(v=>v+1)}>Vergleich aktualisieren</button></div>
  <p>Lesender Vergleich mit anderen aktuellen Rechnungsfällen im freigeschalteten Projektbestand. Hinweise bestätigen noch keine Doppelrechnung und verändern keine Freigabe.</p>
  {loading&&<p role="status">Rechnungsfälle werden verglichen …</p>}
  {error&&<p role="status">{error}</p>}
  {result&&<>
   <p className="font-medium">{result.status==='REVIEW_SUGGESTED'?`${result.findingCount} Verdachtshinweis${result.findingCount===1?'':'e'} zur Prüfung`
    :result.status==='INCOMPLETE'?'Vergleichsgrundlage ist unvollständig':'Keine Treffer in den unterstützten Vergleichen'}</p>
   <p>{result.coverage.otherCasesRead} andere aktuelle Fälle verglichen.</p>
   {(result.coverage.scanTruncated||result.coverage.unusableBasis>0||result.coverage.incompleteSignals>0)&&
    <p>Die Prüfung deckt den Bestand oder die benötigten Merkmale nicht vollständig ab. Daraus folgt keine Dublettenfreiheit.</p>}
   {result.coverage.findingsTruncated&&<p>Es werden die ersten 50 Hinweise angezeigt.</p>}
   <ul className="space-y-3">{result.findings.map(f=><li key={f.recordId} className="space-y-1 rounded border p-2">
    <p className="font-medium">{labels[f.code]}</p><a className="break-words underline" href={`/cases/${encodeURIComponent(f.recordId)}`}>{f.title}</a>
    <p>{[f.number,f.issueDate,f.amount,f.currency].filter(v=>v!==null).join(' · ')}</p>
    {f.reasons.map((reason,i)=><p key={i}>{reason}</p>)}
    {f.code==='IDENTICAL_XML'&&f.pdfRelationship==='DIFFERENT_PDF'&&<p>Die XML ist identisch, die PDF-Dateien unterscheiden sich.</p>}
    {f.changedFields.length>0&&<p>Weitere Rechnungsmerkmale unterscheiden sich. Beide Fassungen fachlich abgleichen.</p>}
   </li>)}</ul>
   <p className="text-xs text-muted-foreground">Vergleich an die angezeigte Fassung gebunden; vor einer Entscheidung bei geändertem Bestand aktualisieren.</p>
  </>}
 </section>;
}

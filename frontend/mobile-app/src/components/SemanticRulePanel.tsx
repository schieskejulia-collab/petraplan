import { useEffect, useState } from 'react';
import { currentAccessToken } from '@/lib/bridge-auth';
import { semanticRuleRequest, type SemanticRule, type SemanticRuleDefinition, type SemanticRuleEvidence } from '@/lib/semantic-rule-client';

const CRITERIA = [
  ['identities_checked', 'Frage, Quellgröße und Zielgröße sind eindeutig.'],
  ['meaning_evidence_checked', 'Die Belege tragen die behauptete Bedeutung.'],
  ['source_coverage_checked', 'Die erforderlichen Quellen wurden geprüft.'],
  ['counterexamples_checked', 'Gegenbeispiele, Ausnahmen und Grenzen wurden geprüft.'],
  ['scope_checked', 'Meine fachliche Berechtigung gilt für genau diesen Geltungsbereich.'],
] as const;
const LABELS: Record<string, string> = { PROPOSED:'VORGESCHLAGEN',APPROVED:'GENEHMIGT',REJECTED:'ABGELEHNT',REVOKED:'WIDERRUFEN',SUPERSEDED:'ERSETZT' };
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
const emptyDraft = () => ({ question:'',condition:'',conclusion:'',justification:'',meaningReference:'',meaningSummary:'',
  limitations:'',exceptions:'',unresolved:'Fachliche Bedeutung noch nicht belegt.' });
type DecisionDraft = { reason: string; checks: Record<string, boolean> };

export function SemanticRulePanel({ recordId, claims, onChanged }: {
  recordId: string; claims: Array<Record<string, unknown>>; onChanged: () => Promise<void>;
}) {
  const [rules, setRules] = useState<SemanticRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [claimId, setClaimId] = useState('');
  const [previous, setPrevious] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [additionalEvidence, setAdditionalEvidence] = useState<SemanticRuleEvidence[]>([]);
  const [decisions, setDecisions] = useState<Record<string, DecisionDraft>>({});
  const eligible = claims.filter(claim => ['SEMANTIC','SEMANTIC_MAPPING','MAPPING','AGGREGATION'].includes(String(claim.claim_type))
    && !['REJECTED','SUPERSEDED'].includes(String(claim.status)));

  useEffect(() => {
    let active = true;
    setLoading(true); setCatalogReady(false); setError(null); setRules([]); setClaimId(''); setPrevious(null); setDraft(emptyDraft()); setAdditionalEvidence([]); setDecisions({});
    void currentAccessToken().then(async token => {
      if (!token) throw new Error('Bitte anmelden, um Regelvorschläge zu prüfen.');
      const data = await semanticRuleRequest(recordId, token);
      if (active) { setRules(data.rules); setCatalogReady(true); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recordId]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const token = await currentAccessToken();
      if (!token) throw new Error('Bitte zuerst anmelden.');
      await semanticRuleRequest(recordId, token, body);
      const data = await semanticRuleRequest(recordId, token);
      setRules(data.rules); setDecisions({});
      if (body.action === 'propose') { setDraft(emptyDraft()); setAdditionalEvidence([]); setPrevious(null); setClaimId(''); }
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Regelentscheidung konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  };
  const propose = () => {
    const definition: SemanticRuleDefinition = {
      question:draft.question,condition:draft.condition,conclusion:draft.conclusion,justification:draft.justification,
      evidence:[...additionalEvidence,...(draft.meaningReference.trim() ? [{kind:'MEANING' as const,reference:draft.meaningReference.trim(),summary:draft.meaningSummary.trim()}] : [])],
      limitations:lines(draft.limitations),exceptions:lines(draft.exceptions),unresolved_items:lines(draft.unresolved),
    };
    void save({action:'propose',claim_id:claimId,previous_version_id:previous,definition});
  };
  const revise = (rule: SemanticRule) => {
    const meaning = rule.evidence.find(evidence => evidence.kind === 'MEANING');
    setAdditionalEvidence(rule.evidence.filter(evidence => evidence !== meaning));
    setClaimId(rule.claim_id); setPrevious(rule.id);
    setDraft({question:rule.question,condition:rule.condition_description,conclusion:rule.conclusion_description,
      justification:rule.justification,meaningReference:meaning?.reference ?? '',meaningSummary:meaning?.summary ?? '',
      limitations:rule.limitations.join('\n'),exceptions:rule.exceptions.join('\n'),unresolved:rule.unresolved_items.join('\n')});
  };
  const draftValid = claimId && ['question','condition','conclusion','justification'].every(key => draft[key as keyof typeof draft].trim().length >= 8)
    && (!draft.meaningReference.trim() || draft.meaningSummary.trim().length >= 8);
  return <section className="bridge-proof-form mb-4 rounded-2xl border bg-card p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase text-muted-foreground">Fachliche Bedeutungsregeln</p>
    <h2 className="mt-1 text-lg font-semibold">Was darf aus dem Quellwert folgen?</h2>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Eine Genehmigung gilt für diesen Fall und diesen Snapshot. Sie bestätigt keinen Claim automatisch und erteilt keine Freigabe. Die Anwendung der Regel in der Neuvalidierung bleibt ein eigener Schritt.</p>
    {loading && <p className="mt-3 text-xs">Regelvorschläge werden geladen …</p>}
    {error && <p role="alert" className="mt-3 rounded-lg border p-3 text-xs">{error}</p>}
    {!loading && <div className="mt-4 space-y-3">{rules.map(rule => {
      const decision = decisions[rule.id] ?? {reason:'',checks:{}};
      const approvalReady = rule.snapshot_current && rule.unresolved_items.length === 0 && rule.evidence.some(item => item.kind === 'MEANING')
        && CRITERIA.every(([key]) => decision.checks[key]);
      return <article key={rule.id} className="rounded-xl border p-3 text-xs">
        <div className="flex justify-between gap-3"><strong>{rule.question}</strong><span>{LABELS[rule.status]} · v{rule.version}</span></div>
        <p className="mt-2 break-all text-muted-foreground">{rule.source_address} → {rule.target_address}</p>
        <p className="mt-2"><strong>Wenn:</strong> {rule.condition_description}</p>
        <p className="mt-1"><strong>Dann:</strong> {rule.conclusion_description}</p>
        <p className="mt-1"><strong>Begründung:</strong> {rule.justification}</p>
        <p className="mt-2 break-all text-muted-foreground">Snapshot: {rule.snapshot_id}{!rule.snapshot_current && ' · nicht mehr aktuell'}</p>
        <details className="mt-2"><summary>Belege und Grenzen</summary><div className="mt-2 space-y-2">
          {rule.evidence.length ? rule.evidence.map((item,index) => <p key={index}><strong>{item.kind === 'MEANING' ? 'Bedeutungsbeleg' : item.kind === 'SOURCE' ? 'Quellbeleg' : 'Berechtigungsbeleg'}:</strong> <span className="break-all">{item.reference}</span> · {item.summary}</p>) : <p>Kein Bedeutungsbeleg hinterlegt.</p>}
          {rule.limitations.map((text,index) => <p key={`l${index}`}>Grenze: {text}</p>)}
          {rule.exceptions.map((text,index) => <p key={`e${index}`}>Ausnahme: {text}</p>)}
          {rule.unresolved_items.map((text,index) => <p key={`u${index}`}>Offen: {text}</p>)}
        </div></details>
        {['PROPOSED','APPROVED'].includes(rule.status) && (rule.decision_authority ? <div className="mt-3 space-y-2 border-t pt-3">
          <p className="break-all text-muted-foreground">Fachliche Rolle: {rule.decision_authority.role_name} · Nachweis: {rule.decision_authority.authority_reference}</p>
          {rule.status === 'PROPOSED' && CRITERIA.map(([key,text]) => <label key={key} className="flex items-start gap-2"><input type="checkbox" checked={Boolean(decision.checks[key])} disabled={busy} onChange={event => setDecisions(values => ({...values,[rule.id]:{...decision,checks:{...decision.checks,[key]:event.target.checked}}}))}/><span>{text}</span></label>)}
          <label className="block">Begründung der Entscheidung<textarea rows={2} className="mt-1 w-full rounded-lg border bg-background p-2" value={decision.reason} disabled={busy} onChange={event => setDecisions(values => ({...values,[rule.id]:{...decision,reason:event.target.value}}))}/></label>
          <div className="flex flex-wrap gap-2">{(rule.status === 'PROPOSED' ? [['approve','Regel genehmigen'],['reject','Regel ablehnen']] : [['revoke','Regel widerrufen'],['supersede','Regel ersetzen']]).map(([action,text]) => <button key={action} className="rounded-lg border p-2 font-semibold disabled:opacity-50" disabled={busy || decision.reason.trim().length < 8 || (action === 'approve' && !approvalReady)} onClick={() => void save({action,rule_version_id:rule.id,authority_id:rule.decision_authority!.id,reason:decision.reason,criteria:decision.checks})}>{text}</button>)}</div>
          {rule.status === 'PROPOSED' && (rule.unresolved_items.length > 0 || !rule.evidence.some(item => item.kind === 'MEANING')) && <p>Offene Fragen oder fehlende Bedeutungsbelege sperren die Genehmigung.</p>}
        </div> : <p className="mt-3 rounded-lg bg-muted/40 p-2">Für deine Anmeldung ist keine gültige fachliche Entscheidungsberechtigung für diesen Geltungsbereich hinterlegt. Die technische Reviewer-Rolle allein genügt nicht.</p>)}
        <button className="mt-3 rounded-lg border p-2 disabled:opacity-50" disabled={busy} onClick={() => revise(rule)}>Neue Version vorbereiten</button>
        {rule.history.length > 0 && <details className="mt-3"><summary>Entscheidungshistorie</summary>{rule.history.map(event => <p className="mt-2" key={event.id}>{LABELS[event.decision]} · {event.decided_at}<br/>{event.reason}<br/><span className="break-all text-muted-foreground">Entschieden von: {event.actor_id} · {event.authority_role ?? 'Rolle nicht verfügbar'}<br/>Berechtigungsbeleg: {event.authority_reference ?? 'Nicht verfügbar'}</span></p>)}</details>}
      </article>;
    })}</div>}
    {catalogReady && eligible.length > 0 && <details className="mt-4 rounded-xl border p-3" open={Boolean(previous)}>
      <summary className="text-sm font-semibold">{previous ? 'Neue Regelversion formulieren' : 'Regelvorschlag formulieren'}</summary>
      <div className="mt-3 space-y-3 text-xs">
        <label className="block">Fachlicher Claim<select disabled={busy || Boolean(previous)} className="mt-1 w-full rounded-lg border bg-background p-2" value={claimId} onChange={event => setClaimId(event.target.value)}><option value="">Claim auswählen</option>{eligible.map(claim => <option key={String(claim.id)} value={String(claim.id)}>{String(claim.statement)}</option>)}</select></label>
        {([
          ['question','Welche Frage beantwortet die Regel?'],['condition','Unter welcher Bedingung gilt sie?'],['conclusion','Welche Schlussfolgerung soll gelten?'],['justification','Warum ist diese Ableitung fachlich begründet?'],
          ['meaningReference','Bedeutungsbeleg: Fundstelle oder Dokumentreferenz (optional beim Vorschlag)'],['meaningSummary','Was belegt diese Fundstelle?'],
          ['limitations','Grenzen (eine pro Zeile)'],['exceptions','Ausnahmen (eine pro Zeile)'],['unresolved','Offene Fragen (eine pro Zeile)'],
        ] as const).map(([key,text]) => <label key={key} className="block">{text}<textarea rows={2} className="mt-1 w-full rounded-lg border bg-background p-2" value={draft[key]} disabled={busy} onChange={event => setDraft(value => ({...value,[key]:event.target.value}))}/></label>)}
        <p className="text-muted-foreground">Ohne Bedeutungsbeleg darfst du einen Vorschlag speichern. Er bleibt offen und kann nicht genehmigt werden.</p>
        {additionalEvidence.length > 0 && <div className="space-y-2"><p>Weitere Belege aus der vorherigen Version:</p>{additionalEvidence.map((item,index) => <div className="rounded-lg border p-2" key={index}><p className="break-all">{item.reference} · {item.summary}</p><button disabled={busy} className="mt-1 underline" onClick={() => setAdditionalEvidence(items => items.filter((_,position) => position !== index))}>Aus dem neuen Vorschlag entfernen</button></div>)}</div>}
        <button className="rounded-lg border p-3 font-semibold disabled:opacity-50" disabled={busy || !draftValid} onClick={propose}>Als Vorschlag speichern</button>
        {previous && <button className="ml-2 rounded-lg border p-3" disabled={busy} onClick={() => {setPrevious(null);setDraft(emptyDraft());setAdditionalEvidence([]);setClaimId('');}}>Neue Version verwerfen</button>}
      </div>
    </details>}
    {catalogReady && eligible.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Zuerst einen expliziten fachlichen Claim zum Kandidaten anlegen.</p>}
  </section>;
}

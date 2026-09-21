import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";
import { bridgeAuth, bridgeAuthRedirectUrl, currentAccessToken } from "@/lib/bridge-auth";
import { getBridgeDecisionAccess, submitBridgeDecision, type BridgeDecisionAccess, type BridgeDecisionAction } from "@/lib/bridge-decision-client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function label(value: unknown) {
  const raw = String(value ?? "offen").toLowerCase();
  if (raw === "trusted") return "FREIGEGEBEN";
  if (raw === "blocked") return "BLOCKIERT";
  if (raw === "revoked") return "WIDERRUFEN";
  if (raw === "exception") return "AUSNAHME";
  if (["passed", "pass", "valid", "validated", "approved", "success"].includes(raw)) return "BESTANDEN";
  if (raw === "failed") return "FEHLGESCHLAGEN";
  return raw.toUpperCase();
}

function JsonValue({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

const BRIDGE_MAPPING_ROWS = [
  ['KUNDEN_NR', 'customerId'],
  ['AUFTRAGS_NR', 'orderId'],
  ['STATUS', 'status'],
  ['MENGE', 'quantity'],
  ['DATUM', 'orderDate'],
] as const;

function BridgeFieldTable({ source, target }: { source: Record<string, unknown>; target: Record<string, unknown> }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[1.15fr_1fr_1fr] bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Brücke</span><span>Quelle</span><span>Ziel</span></div>
      {BRIDGE_MAPPING_ROWS.map(([from, to]) => <div key={from} className="grid grid-cols-[1.15fr_1fr_1fr] gap-2 border-t px-3 py-2 text-xs"><span className="break-all font-medium">{from} → {to}</span><span className="break-all text-muted-foreground">{String(source[from] ?? '—') || '—'}</span><span className="break-all">{String(target[to] ?? '—') || '—'}</span></div>)}
    </div>
  );
}

export default function LiveBridgePage() {
  const [, params] = useRoute("/bridge/:caseId");
  const [, setLocation] = useLocation();
  const caseId = params?.caseId ?? "";
  const [data, setData] = useState<CaseTrace | null>(null);
  const [access, setAccess] = useState<BridgeDecisionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [criteria, setCriteria] = useState({ source_truth_checked: false, translation_trace_checked: false, blockers_resolved: false });

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const trace = await milaApi.caseTrace(caseId);
      setData(trace);
      const token = await currentAccessToken();
      setSessionReady(Boolean(token));
      if (token) setAccess(await getBridgeDecisionAccess(caseId, token));
      else setAccess(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bridge-Fall konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const { data: listener } = bridgeAuth.auth.onAuthStateChange(() => void load());
    return () => listener.subscription.unsubscribe();
  }, [caseId]);

  const sendMagicLink = async () => {
    setAuthMessage(null);
    const normalized = email.trim();
    if (!normalized) return setAuthMessage("E-Mail-Adresse eingeben.");
    const { error: authError } = await bridgeAuth.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: bridgeAuthRedirectUrl() },
    });
    setAuthMessage(authError ? authError.message : "Anmeldelink wurde gesendet. Öffne ihn auf diesem Gerät.");
  };

  const act = async (action: BridgeDecisionAction) => {
    const token = await currentAccessToken();
    if (!token) return setAuthMessage("Bitte zuerst anmelden.");
    setBusy(true);
    setError(null);
    try {
      const trace = await submitBridgeDecision({ recordId: caseId, token, action, reason, criteria });
      setData(trace);
      setAccess(await getBridgeDecisionAccess(caseId, token));
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="min-h-screen p-5 text-sm text-muted-foreground">Lade Live-Bridge…</main>;
  if (error && !data) return <main className="min-h-screen p-5"><button className="mb-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button><div className="rounded-xl border p-4 text-sm">{error}</div></main>;
  if (!data) return null;

  const ingestion = data.source.ingestion;
  const rawPayload = isRecord(ingestion?.raw_payload) ? ingestion.raw_payload : data.source.record;
  const extracted = data.semantic.extracted_schema;
  const bridgeInput = isRecord(extracted?.bridge_input_raw) ? extracted.bridge_input_raw : isRecord(data.semantic.metadata?.bridge_input_raw) ? data.semantic.metadata.bridge_input_raw as Record<string, unknown> : rawPayload;
  const mappedPayload = isRecord(extracted?.mapped_payload) ? extracted.mapped_payload : isRecord(data.semantic.metadata?.mapped_payload) ? data.semantic.metadata.mapped_payload as Record<string, unknown> : {};
  const authoritative = data.validation.authoritative;
  const review = data.review.current;
  const release = data.release.effective_status;
  const gate = data.release.gate;
  const addressable = isRecord(extracted?.addressable_snapshot) ? extracted.addressable_snapshot : null;
  const candidates = Array.isArray(addressable?.candidates) ? addressable.candidates.filter(isRecord) : [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-5 pb-16">
        <header className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Live Bridge</p><h1 className="mt-1 truncate text-2xl font-semibold">{data.title}</h1><p className="mt-1 text-xs text-muted-foreground">{String(ingestion?.source_system ?? data.source.record.source_system ?? "Quelle unbekannt")} · Case {data.id.slice(0, 8)}</p></div><button className="shrink-0 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>Zurück</button></header>

        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktueller Zustand</p><p className="mt-1 text-xl font-semibold">{label(release ?? data.status)}</p></div><div className="text-right text-xs text-muted-foreground"><p>{data.conflict.conflicts.length} Konflikt{data.conflict.conflicts.length === 1 ? "" : "e"}</p><p>Validation: {label(authoritative?.status)}</p></div></div>{gate && <p className="mt-3 text-sm leading-relaxed">{gate.reason}</p>}</section>

        <section className="mb-4 space-y-3 rounded-2xl border bg-card p-4 shadow-sm"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Übersetzung</p><h2 className="mt-1 text-lg font-semibold">Was tatsächlich verarbeitet wurde</h2></div>{Object.keys(mappedPayload).length > 0 ? <BridgeFieldTable source={bridgeInput} target={mappedPayload} /> : <div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-muted-foreground">SOURCE</p><JsonValue value={rawPayload} /></div><div><p className="mb-2 text-xs font-semibold text-muted-foreground">ÜBERSETZUNG</p><JsonValue value={extracted ?? data.semantic.metadata} /></div></div>}{Boolean(ingestion?.source_hash) && <p className="break-all text-[11px] text-muted-foreground">Source hash: {String(ingestion?.source_hash)}</p>}</section>

        {addressable && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address Layer · gespeicherter Snapshot</p><h2 className="mt-1 text-lg font-semibold">{String(addressable.rootAddress ?? 'Adressraum')}</h2><p className="mt-1 text-xs text-muted-foreground">Kandidaten und ihre erste Zustandshistorie wurden mit diesem Fall gespeichert.</p><div className="mt-3 space-y-3">{candidates.map((candidate) => <div key={String(candidate.id)} className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong className="break-all font-mono">{String(candidate.id)}</strong><span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{String(candidate.state).toUpperCase()}</span></div><p className="mt-2">{String(candidate.sourceAddress)} → {String(candidate.proposedValue)}</p><p className="mt-1 text-muted-foreground">{String(candidate.evidence)}</p><p className="mt-2 text-muted-foreground">Impact: {Array.isArray(candidate.impactAddresses) ? candidate.impactAddresses.join(', ') : '—'}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Zustandshistorie</summary><JsonValue value={candidate.stateHistory} /></details></div>)}</div></section>}

        {data.conflict.conflicts.length > 0 && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Offene Punkte</h2><span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{data.conflict.conflicts.length}</span></div><div className="space-y-2">{data.conflict.conflicts.map((conflict, index) => <div key={String(conflict.id ?? index)} className="rounded-xl border p-3"><p className="text-sm font-semibold">{String(conflict.title ?? conflict.conflict_type ?? conflict.type ?? `Konflikt ${index + 1}`)}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{String(conflict.description ?? conflict.reason ?? conflict.message ?? "Kein Beschreibungstext gespeichert.")}</p></div>)}</div></section>}

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Entscheidung</h2>
          <div className="mt-3 divide-y rounded-xl border"><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Validation</span><strong>{label(authoritative?.status)}</strong></div><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Review</span><strong>{review?.complete ? label(review.decision ?? "vollständig") : "OFFEN"}</strong></div><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Release</span><strong>{label(release)}</strong></div></div>

          {!sessionReady && <div className="mt-4 rounded-xl border p-3"><p className="text-sm font-semibold">Für Entscheidungen anmelden</p><div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail-Adresse"/><button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void sendMagicLink()}>Link senden</button></div>{authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}</div>}

          {sessionReady && access && <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">Berechtigung: <strong>{access.role}</strong></p>
            {access.can_review && access.review_ready && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Prüfung bestätigen</p><div className="mt-2 space-y-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={criteria.source_truth_checked} onChange={(e)=>setCriteria(v=>({...v,source_truth_checked:e.target.checked}))}/><span>Source Truth geprüft</span></label><label className="flex gap-2"><input type="checkbox" checked={criteria.translation_trace_checked} onChange={(e)=>setCriteria(v=>({...v,translation_trace_checked:e.target.checked}))}/><span>Übersetzung/Spur geprüft</span></label><label className="flex gap-2"><input type="checkbox" checked={criteria.blockers_resolved} onChange={(e)=>setCriteria(v=>({...v,blockers_resolved:e.target.checked}))}/><span>Blockierende Punkte geklärt</span></label></div></div>}
            <textarea className="w-full rounded-xl border bg-background p-3 text-sm" rows={3} value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Begründung der Entscheidung" />
            {error && <p className="text-sm">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {access.can_review && access.review_ready && <><button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('approve_review')}>Review bestätigen</button><button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('reject_review')}>Review ablehnen</button></>}
              {access.release_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('release')}>Freigabe erteilen</button>}
              {access.revoke_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('revoke')}>Freigabe widerrufen</button>}
            </div>
          </div>}
        </section>
      </div>
    </main>
  );
}

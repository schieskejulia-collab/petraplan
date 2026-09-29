import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { milaApi, type CaseTrace } from "@/api/connector";
import { bridgeAuth, bridgeAuthRedirectUrl, currentAccessToken } from "@/lib/bridge-auth";
import { getBridgeDecisionAccess, revalidateBridgeCase, submitBridgeDecision, type BridgeDecisionAccess, type BridgeDecisionAction } from "@/lib/bridge-decision-client";
import { createExplicitClaim, type ExplicitClaimType } from "@/lib/bridge-claim-client";

const CLAIM_TYPE_OPTIONS: ExplicitClaimType[] = [
  'SOURCE',
  'STRUCTURE',
  'REPRESENTATION',
  'SEMANTIC',
  'SEMANTIC_MAPPING',
  'MAPPING',
  'AGGREGATION',
  'CONTEXT',
  'BEHAVIOR',
  'VALIDATION',
  'DECISION',
  'AUTHORIZATION',
];

type ClaimDraftState = {
  statement: string;
  claimType: '' | ExplicitClaimType;
  subjectAddress: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function label(value: unknown) {
  const raw = String(value ?? "offen").toLowerCase();
  if (raw === "trusted") return "FREIGEGEBEN";
  if (raw === "blocked") return "BLOCKIERT";
  if (raw === "revoked") return "WIDERRUFEN";
  if (raw === "superseded") return "NEUE FREIGABE NÖTIG";
  if (raw === "exception") return "AUSNAHME";
  if (raw === "open") return "OFFEN";
  if (raw === "candidate") return "KANDIDAT";
  if (raw === "confirmed") return "BESTÄTIGT";
  if (raw === "rejected") return "ABGELEHNT";
  if (["passed", "pass", "valid", "validated", "approved", "success"].includes(raw)) return "BESTANDEN";
  if (raw === "failed") return "FEHLGESCHLAGEN";
  if (raw === "unproven") return "NICHT BELEGT";
  return raw.toUpperCase();
}

function JsonValue({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

function bridgeCellValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
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
      {BRIDGE_MAPPING_ROWS.map(([from, to]) => <div key={from} className="grid grid-cols-[1.15fr_1fr_1fr] gap-2 border-t px-3 py-2 text-xs"><span className="break-all font-medium">{from} → {to}</span><span className="break-all text-muted-foreground">{bridgeCellValue(source[from])}</span><span className="break-all">{bridgeCellValue(target[to])}</span></div>)}
    </div>
  );
}

function NorthwindSourceContext({ payload }: { payload: Record<string, unknown> }) {
  const order = isRecord(payload.order) ? payload.order : null;
  const customer = isRecord(payload.customer) ? payload.customer : null;
  const details = Array.isArray(payload.orderDetails) ? payload.orderDetails.filter(isRecord) : [];
  if (!order || details.length === 0) return null;

  const orderId = bridgeCellValue(order.OrderID);
  const customerId = bridgeCellValue(order.CustomerID);
  const sourceFields = [
    ['OrderID', order.OrderID],
    ['CustomerID', order.CustomerID],
    ['OrderDate', order.OrderDate],
    ['RequiredDate', order.RequiredDate],
    ['ShippedDate', order.ShippedDate],
    ['ShipVia', order.ShipVia],
    ['Freight', order.Freight],
  ] as const;

  return (
    <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quellkontext · unveränderter Snapshot</p>
      <h2 className="mt-1 text-lg font-semibold">Wo liegt der Fall – und was steht dort wirklich?</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Hier siehst du den gespeicherten Northwind-Ausschnitt vor Bridge-Regeln, Kandidaten und Entscheidungen. Nebeneinander anzeigen bedeutet noch keine fachliche Bedeutung.</p>

      <div className="mt-3 overflow-hidden rounded-xl border">
        <div className="bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">orders · Kopfzeile</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
          {sourceFields.map(([name, value]) => <div key={name} className="min-w-0"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{name}</p><p className="mt-1 break-all font-medium">{bridgeCellValue(value)}</p></div>)}
          {customer && <div className="min-w-0"><p className="text-[10px] font-semibold uppercase text-muted-foreground">CompanyName</p><p className="mt-1 break-all font-medium">{bridgeCellValue(customer.CompanyName)}</p></div>}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[0.7fr_0.8fr_0.8fr_1fr_0.8fr] gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Zeile</span><span>ProductID</span><span>Quantity</span><span>UnitPrice</span><span>Discount</span></div>
          {details.map((detail, index) => <div key={`${String(detail.OrderID ?? orderId)}-${String(detail.ProductID ?? index)}-${index}`} className="grid grid-cols-[0.7fr_0.8fr_0.8fr_1fr_0.8fr] gap-2 border-t px-3 py-2 text-xs"><span>#{index + 1}</span><span>{bridgeCellValue(detail.ProductID)}</span><strong>{bridgeCellValue(detail.Quantity)}</strong><span>{bridgeCellValue(detail.UnitPrice)}</span><span>{bridgeCellValue(detail.Discount)}</span></div>)}
        </div>
      </div>

      <div className="mt-3 rounded-xl border p-3 text-xs">
        <p className="font-semibold">Sichtbare Beziehungen im Snapshot</p>
        <div className="mt-2 space-y-1 text-muted-foreground">
          <p><span className="font-medium text-foreground">Order {orderId}</span> trägt <span className="font-medium text-foreground">CustomerID {customerId}</span>{customer ? ` und verweist damit auf den sichtbaren Kunden ${bridgeCellValue(customer.CompanyName)}` : ''}.</p>
          <p>Die {details.length} sichtbaren Position{details.length === 1 ? '' : 'en'} tragen dieselbe OrderID und gehören technisch zu diesem Auftrag.</p>
          <p>Die Mengen stehen positionsweise in <span className="font-mono text-foreground">orderDetails[].Quantity</span>. Daraus folgt noch nicht, welche fachliche Kopf-MENGE gelten darf.</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Source Truth bleibt unverändert. Diese Ansicht zeigt Kontext und technische Beziehungen; sie bestätigt weder STATUS noch MENGE und erzeugt keine Rule.</p>
    </section>
  );
}

function representationLabel(value: unknown) {
  const status = String(value ?? 'unknown').toLowerCase();
  if (status === 'preserved') return 'ERHALTEN';
  if (status === 'changed') return 'DARGESTELLT';
  if (status === 'lossy') return 'BESCHÄDIGT';
  return 'UNBEKANNT';
}

function representationValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function addressFragment(address: unknown) {
  return `address-${String(address).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function validationPasses(value: unknown) {
  return ['passed', 'pass', 'valid', 'validated', 'approved', 'success'].includes(String(value ?? '').toLowerCase());
}

function isSingleQuantityCandidate(candidate: Record<string, unknown>) {
  const key = String(candidate.candidate_key ?? candidate.id ?? '');
  const observed = candidate.observed_value ?? candidate.observedValue;
  return key.includes('QUANTITY-AGGREGATION') && Array.isArray(observed) && observed.length === 1;
}

function candidateEvidenceText(candidate: Record<string, unknown>) {
  const observed = candidate.observed_value ?? candidate.observedValue;
  if (isSingleQuantityCandidate(candidate) && Array.isArray(observed)) {
    return `Genau eine positionsbezogene Menge (${representationValue(observed[0])}) wurde beobachtet. Ihre Übernahme als Bridge-MENGE musste fachlich bestätigt werden.`;
  }
  return String(candidate.evidence ?? 'Kein Befund gespeichert.');
}

function claimCandidateId(claim: Record<string, unknown>) {
  if (claim.candidate_id) return String(claim.candidate_id);
  const scope = isRecord(claim.scope_payload) ? claim.scope_payload : null;
  return scope?.candidate_id ? String(scope.candidate_id) : '';
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
  const [candidateReasons, setCandidateReasons] = useState<Record<string, string>>({});
  const [claimDrafts, setClaimDrafts] = useState<Record<string, ClaimDraftState>>({});
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

  const act = async (action: BridgeDecisionAction, candidateId?: string) => {
    const token = await currentAccessToken();
    if (!token) return setAuthMessage("Bitte zuerst anmelden.");
    setBusy(true);
    setError(null);
    try {
      const candidateReason = candidateId ? String(candidateReasons[candidateId] ?? '') : reason;
      await submitBridgeDecision({ recordId: caseId, token, action, reason: candidateReason, criteria, candidate_id: candidateId });
      if (candidateId) setCandidateReasons((value) => ({ ...value, [candidateId]: '' }));
      else setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  const submitClaim = async (candidateId: string, fallbackSubjectAddress: string) => {
    const token = await currentAccessToken();
    if (!token) return setAuthMessage("Bitte zuerst anmelden.");
    const draft = claimDrafts[candidateId] ?? { statement: '', claimType: '', subjectAddress: fallbackSubjectAddress };
    const subjectAddress = draft.subjectAddress || fallbackSubjectAddress;
    if (!draft.claimType) return setError('Bitte zuerst einen Claim-Typ auswählen.');
    if (!subjectAddress) return setError('Für den Claim ist keine zulässige Adresse verfügbar.');
    if (draft.statement.trim().length < 8) return setError('Die Claim-Aussage muss mindestens 8 Zeichen lang sein.');

    setBusy(true);
    setError(null);
    try {
      await createExplicitClaim({
        recordId: caseId,
        token,
        candidate_id: candidateId,
        subject_address: subjectAddress,
        statement: draft.statement.trim(),
        claim_type: draft.claimType,
      });
      setClaimDrafts((value) => ({ ...value, [candidateId]: { statement: '', claimType: '', subjectAddress } }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  const revalidate = async () => {
    const token = await currentAccessToken();
    if (!token) return setAuthMessage("Bitte zuerst anmelden.");
    setBusy(true);
    setError(null);
    try {
      await revalidateBridgeCase(caseId, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neuvalidierung konnte nicht ausgeführt werden.");
    } finally {
      setBusy(false);
    }
  };

  const runControlledNegativeValidation = async () => {
    const token = await currentAccessToken();
    if (!token) return setAuthMessage("Bitte zuerst anmelden.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/test-negative-validation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(String(body.error ?? `HTTP ${response.status}`));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kontrollierter Negativtest konnte nicht ausgeführt werden.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="min-h-screen p-5 text-sm text-muted-foreground">Lade Live-Bridge…</main>;
  if (error && !data) return <main className="min-h-screen p-5"><button className="mb-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>← Fälle</button><div className="rounded-xl border p-4 text-sm">{error}</div></main>;
  if (!data) return null;

  const ingestion = data.source.ingestion;
  const snapshotProcessed = ingestion?.status === 'processed';
  const rawPayload = isRecord(ingestion?.raw_payload) ? ingestion.raw_payload : data.source.record;
  const extracted = data.semantic.extracted_schema;
  const authoritative = data.validation.authoritative;
  const authoritativeEvidence = isRecord(authoritative?.evidence) ? authoritative.evidence : {};
  const bridgeInput = isRecord(authoritativeEvidence.bridge_input_raw)
    ? authoritativeEvidence.bridge_input_raw
    : isRecord(extracted?.bridge_input_raw)
      ? extracted.bridge_input_raw
      : isRecord(data.semantic.metadata?.bridge_input_raw)
        ? data.semantic.metadata.bridge_input_raw as Record<string, unknown>
        : rawPayload;
  const mappedPayload = isRecord(authoritativeEvidence.mapped_payload)
    ? authoritativeEvidence.mapped_payload
    : isRecord(extracted?.mapped_payload)
      ? extracted.mapped_payload
      : isRecord(data.semantic.metadata?.mapped_payload)
        ? data.semantic.metadata.mapped_payload as Record<string, unknown>
        : {};
  const review = data.review.current;
  const release = data.release.effective_status;
  const gate = data.release.gate;
  const releaseComplete = release === 'trusted';
  const displayState = release !== null && release !== undefined
    ? release
    : validationPasses(authoritative?.status) && data.conflict.conflicts.length === 0
      ? 'open'
      : data.status;
  const addressable = isRecord(extracted?.addressable_snapshot) ? extracted.addressable_snapshot : null;
  const candidates = Array.isArray(addressable?.candidates) ? addressable.candidates.filter(isRecord) : [];
  const representationEvidence = Array.isArray(data.representation?.evidence) ? data.representation.evidence.filter(isRecord) : [];
  const rawClaimLayer = (data as CaseTrace & { claim_layer?: unknown }).claim_layer;
  const claimLayer = isRecord(rawClaimLayer) ? rawClaimLayer : {};
  const claims = Array.isArray(claimLayer.claims) ? claimLayer.claims.filter(isRecord) : [];
  const claimEvidenceLinks = Array.isArray(claimLayer.evidence_links) ? claimLayer.evidence_links.filter(isRecord) : [];
  const claimEvidenceByClaimId = new Map<string, Array<Record<string, unknown>>>();
  claimEvidenceLinks.forEach((link) => {
    const key = String(link.claim_id);
    claimEvidenceByClaimId.set(key, [...(claimEvidenceByClaimId.get(key) ?? []), link]);
  });
  const addressLayer = data.address_layer ?? { addresses: [], candidates: [], links: [], history: [] };
  const registeredAddresses = addressLayer.addresses.filter(isRecord);
  const registeredCandidates = addressLayer.candidates.filter(isRecord);
  const addressById = new Map(registeredAddresses.map((item) => [String(item.id), item]));
  const linksByCandidateId = new Map<string, Array<Record<string, unknown>>>();
  addressLayer.links.filter(isRecord).forEach((link) => {
    const key = String(link.candidate_id);
    linksByCandidateId.set(key, [...(linksByCandidateId.get(key) ?? []), link]);
  });
  const historyByCandidateId = new Map<string, Array<Record<string, unknown>>>();
  addressLayer.history.filter(isRecord).forEach((entry) => {
    const key = String(entry.candidate_id);
    historyByCandidateId.set(key, [...(historyByCandidateId.get(key) ?? []), entry]);
  });
  const hasConfirmedCandidate = registeredCandidates.some((candidate) => String(candidate.state) === 'confirmed');
  const isNorthwindCase = Boolean(
    String(extracted?.source_mode ?? '') === 'northwind-proof' ||
    String(ingestion?.source_system ?? '').includes('northwind') ||
    registeredCandidates.some((candidate) => String(candidate.candidate_key ?? '').startsWith('NW:CC:')),
  );
  const canRevalidate = Boolean(
    sessionReady &&
    access?.can_review &&
    snapshotProcessed &&
    isNorthwindCase &&
    access.unresolved_candidate_count === 0 &&
    hasConfirmedCandidate &&
    !validationPasses(authoritative?.status),
  );
  const canRunControlledNegativeTest = Boolean(
    caseId === '9a0698ea-6714-4048-8189-1efa33e6240d' &&
    sessionReady &&
    access?.can_revoke &&
    snapshotProcessed &&
    isNorthwindCase &&
    validationPasses(authoritative?.status) &&
    release === 'trusted',
  );
  const hasEditableDecisionAction = Boolean(
    access && !releaseComplete && (access.review_ready || access.review_rejection_ready || access.release_ready),
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-5 pb-16">
        <header className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan · Live Bridge</p><h1 className="mt-1 truncate text-2xl font-semibold">{data.title}</h1><p className="mt-1 text-xs text-muted-foreground">{String(ingestion?.source_system ?? data.source.record.source_system ?? "Quelle unbekannt")} · Case {data.id.slice(0, 8)}</p></div><button className="shrink-0 rounded-lg border px-3 py-2 text-sm" onClick={() => setLocation("/cases")}>Zurück</button></header>

        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktueller Zustand</p><p className="mt-1 text-xl font-semibold">{label(displayState)}</p></div><div className="text-right text-xs text-muted-foreground"><p>{data.conflict.conflicts.length} Konflikt{data.conflict.conflicts.length === 1 ? "" : "e"}</p><p>Validation: {label(authoritative?.status)}</p></div></div>{gate && <p className="mt-3 text-sm leading-relaxed">{gate.reason}</p>}</section>

        {isNorthwindCase && <NorthwindSourceContext payload={rawPayload} />}

        <section className="mb-4 space-y-3 rounded-2xl border bg-card p-4 shadow-sm"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quelle → Übersetzung</p><h2 className="mt-1 text-lg font-semibold">Was tatsächlich verarbeitet wurde</h2></div>{Object.keys(mappedPayload).length > 0 ? <BridgeFieldTable source={bridgeInput} target={mappedPayload} /> : <div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-muted-foreground">SOURCE</p><JsonValue value={rawPayload} /></div><div><p className="mb-2 text-xs font-semibold text-muted-foreground">ÜBERSETZUNG</p><JsonValue value={extracted ?? data.semantic.metadata} /></div></div>}{Boolean(ingestion?.source_hash) && <p className="break-all text-[11px] text-muted-foreground">Source hash: {String(ingestion?.source_hash)}</p>}</section>

        {authoritative && <section className="mb-4 rounded-2xl border bg-card p-4 text-xs shadow-sm"><h2 className="text-sm font-semibold">Grundlage der aktuellen Verarbeitung</h2><p className="mt-2 break-all">Validierung: {String(authoritative.id)} · {String(authoritative.created_at ?? '')}</p><p className="mt-1 break-all">Quell-Snapshot: {String(authoritativeEvidence.source_snapshot_id ?? 'nicht angegeben')}</p>{Array.isArray(authoritativeEvidence.confirmed_candidate_decisions) && <p className="mt-1">Bestätigte Kandidaten in diesem Lauf: {authoritativeEvidence.confirmed_candidate_decisions.length}</p>}{validationPasses(authoritative.status) && Array.isArray(authoritativeEvidence.trace) && authoritativeEvidence.trace.some((step) => isRecord(step) && step.validation === 'failed') && <p className="mt-2 rounded-lg border p-2">Historischer Prüfbeleg mit abweichender Feldspur: Die Gesamtvalidierung ist bestanden, enthält aber mindestens einen als fehlgeschlagen gespeicherten Feldschritt. Der Originalbeleg bleibt erhalten; zur Klärung sind die damaligen Prüfregeln heranzuziehen.</p>}</section>}

        {claims.length > 0 && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claim Layer · fachliche Aussage</p><h2 className="mt-1 text-lg font-semibold">Was darf behauptet werden?</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ein Claim ist eine konkrete Aussage mit eigenem Status und Scope. Er ersetzt weder Source Truth noch Review oder Release.</p><div className="mt-3 space-y-3">{claims.map((claim) => { const claimId = String(claim.id); const evidenceLinks = claimEvidenceByClaimId.get(claimId) ?? []; return <div key={claimId} className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-all font-mono text-[10px] text-muted-foreground">{String(claim.claim_type ?? 'CLAIM')}</p><strong className="mt-1 block break-words text-sm leading-relaxed">{String(claim.statement ?? 'Keine Aussage gespeichert.')}</strong></div><span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold">{label(claim.status)}</span></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2"><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Scope</p><p className="mt-1 break-words">{String(claim.scope_type ?? '—')}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Adresse</p><p className="mt-1 break-all">{String(claim.subject_address ?? claim.field_address ?? '—')}</p></div></div>{Boolean(claim.rule_id) && <p className="mt-2 text-muted-foreground">Regel: <span className="font-medium text-foreground">{String(claim.rule_id)}{claim.rule_version ? `@${String(claim.rule_version)}` : ''}</span></p>}{Boolean(claim.confirmed_by) && <p className="mt-1 text-muted-foreground">Bestätigt durch: <span className="font-medium text-foreground">{String(claim.confirmed_by)}</span>{claim.confirmed_at ? ` · ${String(claim.confirmed_at)}` : ''}</p>}<details className="mt-3"><summary className="cursor-pointer font-medium">Evidence ({evidenceLinks.length})</summary><div className="mt-2 space-y-2">{evidenceLinks.length ? evidenceLinks.map((link) => <div key={String(link.id)} className="rounded-lg border p-2"><div className="flex items-start justify-between gap-2"><strong>{String(link.relation ?? 'LINK')}</strong><span className="text-[10px] text-muted-foreground">{String(link.directness ?? '')}</span></div><p className="mt-1 break-all text-muted-foreground">{String(link.evidence_type ?? 'Evidence')}: {String(link.evidence_reference ?? '—')}</p>{Boolean(link.note) && <p className="mt-1 leading-relaxed text-muted-foreground">{String(link.note)}</p>}</div>) : <p className="rounded-lg bg-muted/40 p-2 text-muted-foreground">Keine Evidence-Verknüpfung gespeichert.</p>}</div></details></div>; })}</div></section>}

        {!snapshotProcessed && <p className="mb-4 rounded-xl border p-3 text-sm">Quell-Snapshot {label(ingestion?.status ?? "unbekannt")}: Entscheidungen bleiben bis zur vollständigen Verarbeitung gesperrt.</p>}

        {representationEvidence.length > 0 && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Representation Evidence · ursprünglicher Snapshot</p><h2 className="mt-1 text-lg font-semibold">Wertdarstellung zum Zeitpunkt der Erfassung</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Dieser unveränderte historische Befund zeigt den Stand bei der Erfassung, vor späteren Kandidatenentscheidungen. Die aktuell verarbeiteten Werte stehen oben; ihre Grundlage ist die maßgebliche Validierung.</p><div className="mt-3 space-y-3">{representationEvidence.map((evidence) => <div key={String(evidence.id)} className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong className="break-all">{String(evidence.field_address)}</strong><span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold">{representationLabel(evidence.fidelity_status)}</span></div><div className="mt-3 grid grid-cols-3 gap-2 border-y py-2"><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Quelle</p><p className="mt-1 break-words">{representationValue(evidence.raw_representation)}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Bridge</p><p className="mt-1 break-words">{representationValue(evidence.bridge_representation)}</p></div><div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Anzeige</p><p className="mt-1 break-words">{representationValue(evidence.display_representation)}</p></div></div><p className="mt-2 leading-relaxed text-muted-foreground">{String(evidence.assessment_note)}</p></div>)}</div></section>}

        {registeredCandidates.length > 0 && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adressschicht · gespeicherter Snapshot</p><h2 className="mt-1 text-lg font-semibold">Auflösbare Kandidaten</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Die Kandidatenentscheidung beantwortet nur die fachliche Frage „Darf diese Regel für diesen Scope gelten?“. Sie verändert die Source nicht und ist noch keine Fallfreigabe.</p><div className="mt-3 space-y-3">{registeredCandidates.map((candidate) => {
          const candidateId = String(candidate.id);
          const source = addressById.get(String(candidate.source_address_id));
          const impacts = (linksByCandidateId.get(candidateId) ?? []).map((link) => addressById.get(String(link.address_id))).filter(isRecord);
          const history = historyByCandidateId.get(candidateId) ?? [];
          const open = String(candidate.state) === 'candidate';
          const confirmed = String(candidate.state) === 'confirmed';
          const singleQuantity = isSingleQuantityCandidate(candidate);
          const existingClaim = claims.find((claim) => claimCandidateId(claim) === candidateId);
          const subjectAddressOptions = Array.from(new Map([source, ...impacts].filter(isRecord).map((item) => [String(item.address), item])).values());
          const fallbackSubjectAddress = String((impacts[0] ?? source)?.address ?? '');
          const draft = claimDrafts[candidateId] ?? { statement: '', claimType: '', subjectAddress: fallbackSubjectAddress };
          return <div key={candidateId} className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong className="break-all font-mono">{String(candidate.candidate_key)}</strong><span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold">{label(candidate.state)}</span></div><p className="mt-2">{representationValue(candidate.observed_value)} → {representationValue(candidate.proposed_value)}</p><p className="mt-1 leading-relaxed text-muted-foreground"><span className="font-semibold">Einordnung: </span>{candidateEvidenceText(candidate)}</p>{singleQuantity && String(candidate.evidence ?? '').includes('Mehrere positionsbezogene Mengen') && <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">Gespeicherten historischen Originaltext anzeigen</summary><p className="mt-2 rounded-lg bg-muted/40 p-2 text-muted-foreground">{String(candidate.evidence)}</p></details>}{source && <p className="mt-2"><span className="text-muted-foreground">Quelle: </span><a className="break-all underline" href={`#${addressFragment(source.address)}`}>{String(source.address)}</a></p>}<p className="mt-2 text-muted-foreground">Auswirkungen: {impacts.length ? impacts.map((address, index) => <span key={String(address.id)}>{index > 0 && ', '}<a className="break-all underline" href={`#${addressFragment(address.address)}`}>{String(address.address)}</a></span>) : '—'}</p>{open && snapshotProcessed && sessionReady && access?.can_review && <div className="mt-3 space-y-2 border-t pt-3"><textarea className="w-full rounded-lg border bg-background p-2 text-xs" rows={2} value={candidateReasons[candidateId] ?? ''} onChange={(e) => setCandidateReasons((value) => ({ ...value, [candidateId]: e.target.value }))} placeholder="Begründung der Fachentscheidung"/><div className="grid gap-2 sm:grid-cols-2"><button disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => void act('confirm_candidate', candidateId)}>Kandidat bestätigen</button><button disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => void act('reject_candidate', candidateId)}>Kandidat ablehnen</button></div></div>}{confirmed && existingClaim && <div className="mt-3 rounded-lg border bg-muted/30 p-3"><p className="font-semibold">Expliziter Claim vorhanden · {label(existingClaim.status)}</p><p className="mt-1 leading-relaxed text-muted-foreground">{String(existingClaim.statement ?? 'Claim ohne gespeicherten Aussage-Text.')}</p><p className="mt-2 text-[10px] text-muted-foreground">Candidate-Bestätigung und Claim bleiben getrennte Schritte.</p></div>}{confirmed && !existingClaim && sessionReady && access?.can_review && <div className="mt-3 space-y-2 border-t pt-3"><div><p className="font-semibold">Expliziten Claim anlegen</p><p className="mt-1 leading-relaxed text-muted-foreground">Der bestätigte Candidate wird nicht automatisch zur fachlichen Wahrheit. Der neue Claim startet als NICHT BELEGT und gilt nur für diesen Fall (CASE_ONLY). Rule, Validation, Review und Release bleiben unverändert.</p></div><label className="block"><span className="text-[10px] font-semibold uppercase text-muted-foreground">Claim-Typ</span><select className="mt-1 w-full rounded-lg border bg-background p-2 text-xs" value={draft.claimType} onChange={(e) => setClaimDrafts((value) => ({ ...value, [candidateId]: { ...draft, claimType: e.target.value as '' | ExplicitClaimType } }))}><option value="">Typ auswählen</option>{CLAIM_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="block"><span className="text-[10px] font-semibold uppercase text-muted-foreground">Gegenstand / Adresse</span><select className="mt-1 w-full rounded-lg border bg-background p-2 text-xs" value={draft.subjectAddress || fallbackSubjectAddress} onChange={(e) => setClaimDrafts((value) => ({ ...value, [candidateId]: { ...draft, subjectAddress: e.target.value } }))}>{subjectAddressOptions.map((address) => <option key={String(address.id)} value={String(address.address)}>{String(address.address)}</option>)}</select></label><label className="block"><span className="text-[10px] font-semibold uppercase text-muted-foreground">Fachliche Aussage</span><textarea className="mt-1 w-full rounded-lg border bg-background p-2 text-xs" rows={3} value={draft.statement} onChange={(e) => setClaimDrafts((value) => ({ ...value, [candidateId]: { ...draft, statement: e.target.value } }))} placeholder="Was darf für genau diesen Fall behauptet werden?"/></label><button disabled={busy || !draft.claimType || draft.statement.trim().length < 8 || !fallbackSubjectAddress} className="w-full rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => void submitClaim(candidateId, fallbackSubjectAddress)}>Claim als UNPROVEN / CASE_ONLY anlegen</button></div>}<details className="mt-2"><summary className="cursor-pointer font-medium">Zustandshistorie ({history.length})</summary><div className="mt-2 space-y-2">{history.map((entry) => <div key={String(entry.id)} className="rounded-lg bg-muted/50 p-2"><strong>{label(entry.state)}</strong><span className="text-muted-foreground"> · {String(entry.changed_by)} · {String(entry.changed_at)}</span><p className="mt-1 text-muted-foreground">{String(entry.reason)}</p></div>)}</div></details></div>;
        })}</div><details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">{registeredAddresses.length} registrierte Adressen</summary><div className="mt-2 space-y-2">{registeredAddresses.map((address) => <div key={String(address.id)} id={addressFragment(address.address)} className="rounded-lg border p-2 text-xs"><strong className="break-all font-mono">{String(address.address)}</strong><p className="mt-1 text-muted-foreground">{String(address.kind)} · {String(address.source_path)}</p></div>)}</div></details></section>}

        {registeredCandidates.length === 0 && addressable && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address Layer · gespeicherter Snapshot</p><h2 className="mt-1 text-lg font-semibold">{String(addressable.rootAddress ?? 'Adressraum')}</h2><p className="mt-1 text-xs text-muted-foreground">Kandidaten und ihre erste Zustandshistorie wurden mit diesem Fall gespeichert.</p><div className="mt-3 space-y-3">{candidates.map((candidate) => <div key={String(candidate.id)} className="rounded-xl border p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong className="break-all font-mono">{String(candidate.id)}</strong><span className="rounded-full border px-2 py-1 text-[10px] font-semibold">{String(candidate.state).toUpperCase()}</span></div><p className="mt-2">{String(candidate.sourceAddress)} → {String(candidate.proposedValue)}</p><p className="mt-1 text-muted-foreground"><span className="font-semibold">Ursprünglicher Befund: </span>{String(candidate.evidence)}</p><p className="mt-2 text-muted-foreground">Impact: {Array.isArray(candidate.impactAddresses) ? candidate.impactAddresses.join(', ') : '—'}</p><details className="mt-2"><summary className="cursor-pointer font-medium">Zustandshistorie</summary><JsonValue value={candidate.stateHistory} /></details></div>)}</div></section>}

        {data.conflict.conflicts.length > 0 && <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Offene Punkte</h2><span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{data.conflict.conflicts.length}</span></div><div className="space-y-2">{data.conflict.conflicts.map((conflict, index) => <div key={String(conflict.id ?? index)} className="rounded-xl border p-3"><p className="text-sm font-semibold">{String(conflict.title ?? conflict.conflict_type ?? conflict.type ?? `Konflikt ${index + 1}`)}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{String(conflict.description ?? conflict.reason ?? conflict.message ?? "Kein Beschreibungstext gespeichert.")}</p></div>)}</div></section>}

        <section className="mb-4 rounded-2xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entscheidungslogik</p><h2 className="mt-1 text-lg font-semibold">Warum sind Candidate, Claim, Review und Release getrennt?</h2><div className="mt-3 space-y-3 text-sm"><div className="rounded-xl border p-3"><strong>1 · Kandidat bestätigen</strong><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Hier wird nur entschieden, ob der konkrete Candidate als Grundlage weiterverwendet werden darf. Die tatsächlichen Werte stehen im jeweiligen Candidate — dieser Erklärungstext enthält bewusst keine fremden Beispielwerte. Die Source bleibt unverändert.</p></div><div className="rounded-xl border p-3"><strong>2 · Expliziten Claim anlegen</strong><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Aus einem bestätigten Candidate kann ein Mensch eine konkrete, fallbezogene Aussage formulieren. Sie startet als NICHT BELEGT / CASE_ONLY und wird mit Quelladresse, Snapshot, Candidate-Evidence und menschlicher Bestätigung verknüpft.</p></div><div className="rounded-xl border p-3"><strong>3 · Neuvalidierung und Review</strong><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Erst Rule, Authority und die anschließende Prüfung dürfen entscheiden, ob die Aussage für den vorgesehenen Scope tragfähig ist. Das Review prüft danach den aktuellen konkreten Fallzustand.</p></div><div className="rounded-xl border p-3"><strong>4 · Release</strong><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Erst die separate Freigabe macht das geprüfte Ergebnis verwendbar. Candidate, Claim, Assessment und Review sind jeweils noch kein Release.</p></div></div></section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Entscheidung</h2>
          <div className="mt-3 divide-y rounded-xl border"><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Validation</span><strong>{label(authoritative?.status)}</strong></div><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Review</span><strong>{review?.complete ? label(review.decision ?? "vollständig") : "OFFEN"}</strong></div><div className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="text-muted-foreground">Release</span><strong>{label(release)}</strong></div></div>

          {!sessionReady && <div className="mt-4 rounded-xl border p-3"><p className="text-sm font-semibold">Für Entscheidungen anmelden</p><div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail-Adresse"/><button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void sendMagicLink()}>Link senden</button></div>{authMessage && <p className="mt-2 text-xs text-muted-foreground">{authMessage}</p>}</div>}

          {sessionReady && access && <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">Berechtigung: <strong>{access.role}</strong></p>
            {releaseComplete && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Fall ist bereits freigegeben</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Validation und Review sind abgeschlossen. Es ist keine weitere positive Bestätigung nötig. Nur ein ausdrücklicher Widerruf oder eine spätere neue maßgebliche Validation eröffnet wieder Handlungsbedarf.</p></div>}
            {!releaseComplete && access.can_review && !access.review_ready && Boolean(access.review_blockers?.length) && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Review noch gesperrt</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{access.review_blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
            {!releaseComplete && access.can_release && !access.release_ready && Boolean(access.release_blockers?.length) && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Freigabe noch gesperrt</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{access.release_blockers?.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
            {canRevalidate && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Bestätigte Fachregeln erneut prüfen</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Die Source bleibt unverändert. Ein neuer Bridge-Lauf verwendet nur die bestätigten Kandidaten als Authority Evidence und schreibt anschließend eine neue Validation.</p><button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void revalidate()}>Mit bestätigten Regeln neu validieren</button></div>}
            {canRunControlledNegativeTest && <div className="rounded-xl border border-dashed p-3"><p className="text-sm font-semibold">Kontrollierter Post-Release-Negativtest</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Nur für A-10266: erzeugt eine spätere fehlgeschlagene authoritative Validation. Source, Snapshot, Kandidaten, Representation Evidence und Review bleiben unverändert. Das Release-Gate muss den bestehenden Release anschließend selbst widerrufen.</p><button disabled={busy} className="mt-3 w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void runControlledNegativeValidation()}>Kontrollierten Negativtest auslösen</button></div>}
            {!releaseComplete && access.can_review && access.review_ready && <div className="rounded-xl border p-3"><p className="text-sm font-semibold">Fall-Review bestätigen</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Hier wird der konkrete Fall geprüft — nicht der Kandidat ein zweites Mal.</p><div className="mt-2 space-y-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={criteria.source_truth_checked} onChange={(e)=>setCriteria(v=>({...v,source_truth_checked:e.target.checked}))}/><span>Source Truth geprüft</span></label><label className="flex gap-2"><input type="checkbox" checked={criteria.translation_trace_checked} onChange={(e)=>setCriteria(v=>({...v,translation_trace_checked:e.target.checked}))}/><span>Übersetzung/Spur geprüft</span></label><label className="flex gap-2"><input type="checkbox" checked={criteria.blockers_resolved} onChange={(e)=>setCriteria(v=>({...v,blockers_resolved:e.target.checked}))}/><span>Blockierende Punkte geklärt</span></label></div></div>}
            {(hasEditableDecisionAction || access.revoke_ready) && <textarea className="w-full rounded-xl border bg-background p-3 text-sm" rows={3} value={reason} onChange={(e)=>setReason(e.target.value)} placeholder={releaseComplete ? "Begründung für einen Widerruf" : "Begründung der Entscheidung"} />}
            {error && <p className="text-sm">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {!releaseComplete && access.can_review && access.review_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('approve_review')}>Fall-Review bestätigen</button>}
              {!releaseComplete && access.can_review && access.review_rejection_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('reject_review')}>Fall-Review ablehnen</button>}
              {!releaseComplete && access.release_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('release')}>Freigabe erteilen</button>}
              {access.revoke_ready && <button disabled={busy} className="rounded-xl border px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void act('revoke')}>Freigabe widerrufen</button>}
            </div>
          </div>}
        </section>
      </div>
    </main>
  );
}

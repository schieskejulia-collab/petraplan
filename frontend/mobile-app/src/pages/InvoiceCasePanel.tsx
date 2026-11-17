import { useEffect, useState } from "react";
import { currentAccessToken } from "@/lib/bridge-auth";
import { getBridgeDecisionAccess, submitBridgeDecision, type BridgeDecisionAccess } from "@/lib/bridge-decision-client";
import type { CaseTrace, InvoiceCaseSnapshot } from "@/api/connector";

function dateLabel(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date.toLocaleString("de-DE") : "Zeitpunkt unbekannt";
}

function useOriginalPdf(recordId: string, snapshotId: string) {
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function openPdf() {
    setError(null);
    try {
      const token = await currentAccessToken();
      if (!token) throw new Error("Bitte zuerst anmelden.");
      const response = await fetch(`/api/cases/${encodeURIComponent(recordId)}/invoice-pdf?snapshotId=${encodeURIComponent(snapshotId)}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Original-PDF konnte nicht geladen werden.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "rechnung-original.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setOpened(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Original-PDF konnte nicht geladen werden.");
    }
  }
  return { openPdf, opened, error };
}

function InvoiceSnapshot({ snapshot, visuallyConfirmed }: {
  snapshot: InvoiceCaseSnapshot; visuallyConfirmed: boolean;
}) {
  const { payable, proof } = snapshot;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Rechnungsnummer</dt>
          <dd className="break-words font-medium">{snapshot.number ?? "Nicht eindeutig belegt"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Zahlbetrag laut XML</dt>
          <dd className="break-words font-medium">{payable ? [payable.value, payable.currency].filter(Boolean).join(" ") : "Nicht eindeutig belegt"}</dd>
        </div>
      </dl>
      {snapshot.pdfComparison && (
        <div className="space-y-1 rounded-lg border p-3 text-sm">
          <p className="font-semibold">{visuallyConfirmed ? "PDF-Sichtprüfung bestätigt" : "PDF-Sichtprüfung erforderlich"}</p>
          <p>{snapshot.pdfComparison.status === "DIFFERENT" ? "Sichtbarer Zahlbetrag weicht vom XML ab."
            : snapshot.pdfComparison.status === "NOT_COMPARABLE" ? "Sichtbarer Zahlbetrag nicht eindeutig lesbar."
              : visuallyConfirmed ? "Sichtbetrag und XML sind im Review als übereinstimmend dokumentiert."
                : "OCR-Betrag passt zum XML. Sichtbestätigung steht aus."}</p>
          {snapshot.pdfComparison.candidates.map((item, index) => (
            <p key={index}>Seite {item.page} · {item.amount ?? "Betrag unlesbar"}</p>
          ))}
        </div>
      )}
      {payable && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">XML-Fundstelle zum Zahlbetrag (BT-115)</summary>
          <code className="mt-2 block break-all text-xs">{payable.path}</code>
        </details>
      )}
      <details id={`invoice-proof-${snapshot.snapshotId}`} className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {proof ? `KoSIT-Prüfung ${proof.accepted ? "bestanden" : "fehlgeschlagen"}` : "KoSIT-Prüfbeleg nicht verfügbar"}
        </summary>
        {proof && (
          <div className="mt-3 space-y-2">
            <p>{[snapshot.syntax, proof.engine, proof.scenario].filter(Boolean).join(" · ")}</p>
            {proof.messages.map((message, index) => (
              <div key={index} className="break-words text-sm">
                <span className="font-medium">{message.level === "information" ? "Hinweis" : message.level === "warning" ? "Warnung" : message.level === "error" ? "Fehler" : message.level} {message.code}</span>
                {message.text && <p>{message.text}</p>}
              </div>
            ))}
            <dl className="space-y-1 text-xs text-muted-foreground">
              <div><dt>SHA‑256 der Rechnung</dt><dd className="break-all font-mono">{proof.sourceSha256}</dd></div>
              <div><dt>SHA‑256 des Prüfberichts</dt><dd className="break-all font-mono">{proof.reportSha256}</dd></div>
            </dl>
          </div>
        )}
      </details>
    </div>
  );
}

export default function InvoiceCasePanel({ data, statusLabel, onChanged }: {
  data: CaseTrace;
  onChanged: () => Promise<void>;
  statusLabel: (value: unknown) => string;
}) {
  const snapshots = data.invoice?.snapshots ?? [];
  const current = snapshots.find(snapshot => snapshot.current);
  const history = snapshots.filter(snapshot => !snapshot.current);
  const visuallyConfirmed = (snapshot: InvoiceCaseSnapshot) => Boolean(snapshot.pdfComparison
    && data.review.decisions.some(decision => decision.validation_result_id === snapshot.validationId
      && decision.decision === "approved" && decision.final === true));
  const certificates = new Map(data.release.certificates.map(certificate => [certificate.id, certificate]));
  const status = data.release.effective_status
    ?? (data.release.certificates.length ? "blocked" : null);
  return (
    <section aria-labelledby="invoice-title" className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="invoice-title" className="font-semibold">Rechnungsprüfung</h2>
        <p className="rounded-full border px-2 py-1 text-xs font-semibold">
          {status ? statusLabel(status) : "Keine Freigabe erteilt"}
        </p>
      </div>
      {current ? <InvoiceSnapshot snapshot={current} visuallyConfirmed={visuallyConfirmed(current)} /> : <p className="text-sm">Aktueller Rechnungssnapshot nicht verfügbar.</p>}
      {current && <InvoiceReview key={current.snapshotId} recordId={data.id} snapshot={current} onChanged={onChanged} />}
      {data.release.status_history.length > 0 && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Freigabehistorie</summary>
          <ol className="mt-2 space-y-2">
            {[...data.release.status_history].reverse().map((entry, index) => {
              const certificate = certificates.get(entry.release_certificate_id);
              const basis = snapshots.find(snapshot => snapshot.validationId === certificate?.validation_result_id);
              return (
                <li key={String(entry.id ?? index)} className="break-words border-t pt-2">
                  <p className="font-medium">{statusLabel(entry.new_status)} · {dateLabel(entry.created_at)}</p>
                  {typeof entry.reason === "string" && <p>{entry.reason}</p>}
                  {basis?.proof && <a className="underline" href={`#invoice-proof-${basis.snapshotId}`}
                    onClick={() => {
                      for (const prefix of ["invoice-", "invoice-proof-"]) {
                        const details = document.getElementById(prefix + basis.snapshotId);
                        if (details instanceof HTMLDetailsElement) details.open = true;
                      }
                    }}>Zugehörigen Prüfbeleg ansehen</a>}
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {history.map(snapshot => (
        <details id={`invoice-${snapshot.snapshotId}`} key={snapshot.snapshotId} className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Frühere Fassung · {dateLabel(snapshot.createdAt)}</summary>
          <div className="mt-3"><InvoiceSnapshot snapshot={snapshot} visuallyConfirmed={visuallyConfirmed(snapshot)} /></div>
        </details>
      ))}
    </section>
  );
}

function InvoiceReview({ recordId, snapshot, onChanged }: {
  recordId: string; snapshot: InvoiceCaseSnapshot; onChanged: () => Promise<void>;
}) {
  const [access, setAccess] = useState<BridgeDecisionAccess | null>(null);
  const [criteria, setCriteria] = useState({ source_truth_checked: false, translation_trace_checked: false, blockers_resolved: false });
  const [serviceEvidence, setServiceEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsDeliveryEvidence = snapshot.proof?.messages.some(message => message.code === "BR-DE-TMP-32");
  const pdf = snapshot.pdfComparison;
  const originalPdf = useOriginalPdf(recordId, snapshot.snapshotId);
  const [pdfAmount, setPdfAmount] = useState("");
  const [pdfCurrency, setPdfCurrency] = useState("");
  const [pdfPagesChecked, setPdfPagesChecked] = useState(false);
  const availableReview = Boolean(access?.can_review && access.review_ready
    && (!pdf || (pdf.status === "NEEDS_VISUAL_CONFIRMATION" && snapshot.proof?.accepted)));
  const availableRelease = Boolean(access?.release_ready);
  const completePdfReview = !pdf || (originalPdf.opened && pdfPagesChecked
    && /^-?[0-9]{1,18}(?:[.,][0-9]{1,2})?$/.test(pdfAmount.trim()) && /^[A-Z]{3}$/.test(pdfCurrency.trim().toUpperCase()));
  useEffect(() => {
    let active = true;
    (async () => {
      const token = await currentAccessToken();
      if (token) {
        const current = await getBridgeDecisionAccess(recordId, token);
        if (active) setAccess(current);
      }
    })().catch(() => { if (active) setError("Entscheidungsberechtigungen konnten nicht geladen werden."); });
    return () => { active = false; };
  }, [recordId]);

  async function decide(action: "approve_review" | "release") {
    setBusy(true);
    setError(null);
    try {
      const token = await currentAccessToken();
      if (!token) throw new Error("Bitte erneut anmelden.");
      await submitBridgeDecision({ recordId, action, reason, token,
        expected_snapshot_id: snapshot.snapshotId, expected_validation_id: snapshot.validationId, criteria: {
        ...criteria, ...(needsDeliveryEvidence ? { delivery_period_evidence: serviceEvidence.trim() } : {}),
        ...(pdf && action === "approve_review" && snapshot.proof ? {
          pdf_pages_checked: pdfPagesChecked, pdf_visual_amount: pdfAmount.trim(),
          pdf_visual_currency: pdfCurrency.trim().toUpperCase(),
          pdf_sha256: pdf.sha256, pdf_xml_sha256: snapshot.proof.sourceSha256,
        } : {}),
      } });
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Entscheidung konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  if (!availableReview && !availableRelease && !error && !pdf) return null;
  const labels = { source_truth_checked: "Original geprüft", translation_trace_checked: "Zuordnung geprüft", blockers_resolved: "Offene Punkte geklärt" };
  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      {pdf && <button className="rounded-lg border px-3 py-2" onClick={() => void originalPdf.openPdf()}>
        Original-PDF herunterladen
      </button>}
      {originalPdf.error && <p role="alert">{originalPdf.error}</p>}
      {availableReview && pdf && <div className="space-y-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={pdfPagesChecked}
          disabled={!originalPdf.opened} onChange={event => setPdfPagesChecked(event.target.checked)} />
          Alle Seiten des Original-PDF auf eindeutigen Zahlbetrag geprüft
        </label>
        <label className="block">Sichtbarer Zahlbetrag im PDF
          <input className="mt-1 w-full rounded border bg-background p-2" inputMode="decimal"
            value={pdfAmount} onChange={event => setPdfAmount(event.target.value)} />
        </label>
        <label className="block">Sichtbare Währung (z. B. EUR)
          <input className="mt-1 w-full rounded border bg-background p-2" maxLength={3}
            value={pdfCurrency} onChange={event => setPdfCurrency(event.target.value)} />
        </label>
      </div>}
      {availableReview && (Object.keys(criteria) as Array<keyof typeof criteria>).map(key => (
        <label className="flex items-center gap-2" key={key}>
          <input type="checkbox" checked={criteria[key]} onChange={event => {
            const checked = event.target.checked;
            setCriteria(previous => ({ ...previous, [key]: checked }));
          }} />{labels[key]}
        </label>
      ))}
      {availableReview && needsDeliveryEvidence && <label className="block">
        <span>Beleg zum Liefer- oder Leistungszeitraum (BR-DE-TMP-32)</span>
        <input className="mt-1 w-full rounded border bg-background p-2" value={serviceEvidence}
          onChange={event => setServiceEvidence(event.target.value)} />
      </label>}
      {(availableReview || availableRelease) && <label className="block">
        <span>Begründung</span>
        <textarea className="mt-1 w-full rounded border bg-background p-2" value={reason} onChange={event => setReason(event.target.value)} />
      </label>}
      {availableReview && <button className="rounded-lg border px-3 py-2 disabled:opacity-50"
        disabled={busy || !completePdfReview || reason.trim().length < 3 || !Object.values(criteria).every(Boolean) || Boolean(needsDeliveryEvidence && serviceEvidence.trim().length < 3)}
        onClick={() => void decide("approve_review")}>Review bestätigen</button>}
      {availableRelease && <button className="rounded-lg border px-3 py-2 disabled:opacity-50"
        disabled={busy || reason.trim().length < 3} onClick={() => void decide("release")}>Freigabe erteilen</button>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

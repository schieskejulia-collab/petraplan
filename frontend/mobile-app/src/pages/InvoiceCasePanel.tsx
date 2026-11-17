import type { CaseTrace, InvoiceCaseSnapshot } from "@/api/connector";

function dateLabel(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date.toLocaleString("de-DE") : "Zeitpunkt unbekannt";
}

function InvoiceSnapshot({ snapshot }: { snapshot: InvoiceCaseSnapshot }) {
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

export default function InvoiceCasePanel({ data, statusLabel }: {
  data: CaseTrace;
  statusLabel: (value: unknown) => string;
}) {
  const snapshots = data.invoice?.snapshots ?? [];
  const current = snapshots.find(snapshot => snapshot.current);
  const history = snapshots.filter(snapshot => !snapshot.current);
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
      {current ? <InvoiceSnapshot snapshot={current} /> : <p className="text-sm">Aktueller Rechnungssnapshot nicht verfügbar.</p>}
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
          <div className="mt-3"><InvoiceSnapshot snapshot={snapshot} /></div>
        </details>
      ))}
    </section>
  );
}

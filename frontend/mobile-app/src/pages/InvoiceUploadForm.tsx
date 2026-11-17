import { useRef, useState, type FormEvent } from "react";
import { currentAccessToken } from "@/lib/bridge-auth";

export default function InvoiceUploadForm({ revision, onSaved }: {
  revision?: { recordId: string; snapshotId: string };
  onSaved: (recordId: string) => void;
}) {
  const requestId = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!file.size || file.size > 8 * 1024 * 1024) throw new Error("Datei muss zwischen 1 Byte und 8 MiB groß sein.");
      const token = await currentAccessToken();
      if (!token) throw new Error("Bitte zuerst anmelden.");
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.readAsDataURL(file);
      });
      const recordId = revision?.recordId ?? (requestId.current ??= crypto.randomUUID());
      const response = await fetch("/api/bridge/invoice-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, expectedSnapshotId: revision?.snapshotId ?? null, contentBase64 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Import fehlgeschlagen.");
      setFile(null);
      onSaved(result.record_id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={upload} className="space-y-3 rounded-xl border bg-card p-4">
      <label className="block space-y-2 text-sm font-semibold">
        <span>{revision ? "Neue Fassung hinzufügen" : "Rechnung importieren"}</span>
        <input className="block w-full text-sm" type="file" accept=".xml,.pdf,application/xml,application/pdf" disabled={busy}
          onChange={event => { requestId.current = null; setFile(event.target.files?.[0] ?? null); setError(null); }} />
      </label>
      <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy || !file}>
        {busy ? "Prüfung läuft…" : "Datei prüfen und speichern"}
      </button>
      {error && <p role="alert" className="text-sm">{error}</p>}
    </form>
  );
}

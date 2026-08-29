import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { milaApi, type CaseListItem } from "@/api/connector";

function badge(status: CaseListItem["release_status"]) {
  const label = status ? status.toUpperCase() : "OPEN";
  return <span className="rounded-full border px-2 py-1 text-[11px] font-semibold">{label}</span>;
}

export default function CasesPage() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await milaApi.cases(50, 0);
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fälle konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">PetraPlan</p>
          <h1 className="text-3xl font-semibold">Truth Cases</h1>
          <p className="text-sm text-muted-foreground">Nachvollziehbare Fälle von Source Truth bis Release Truth.</p>
        </header>

        {loading && <p className="text-sm text-muted-foreground">Lade Fälle…</p>}

        {error && (
          <div className="rounded-xl border p-4">
            <p className="text-sm">{error}</p>
            <button className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={() => void load()}>Erneut versuchen</button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-xl border p-6 text-sm text-muted-foreground">Noch keine Fälle vorhanden.</div>
        )}

        <section className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLocation(`/cases/${item.id}`)}
              className="w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{item.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{item.source_system ?? "Unknown source"} · {item.category}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.conflict_count} Konflikt{item.conflict_count === 1 ? "" : "e"}</p>
                </div>
                {badge(item.release_status)}
              </div>
            </button>
          ))}
        </section>
      </div>
    </main>
  );
}

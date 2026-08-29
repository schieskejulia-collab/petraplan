import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ErrorBox } from "@/components/ErrorBox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { milaApi } from "@/api/connector";
import { ArrowLeft, ChevronRight, ShieldCheck, TriangleAlert } from "lucide-react";

function releaseBadge(status: string | null) {
  if (status === "trusted") return <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Trusted</Badge>;
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  if (status === "superseded") return <Badge variant="secondary">Superseded</Badge>;
  return <Badge variant="outline">Open</Badge>;
}

export default function CasesPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["petraplan-cases"],
    queryFn: () => milaApi.cases(50, 0),
  });

  const items = data?.items ?? [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto w-full space-y-5 pb-10">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Start
        </Button>

        <div className="space-y-1">
          <h1 className="text-3xl font-serif text-primary">PetraPlan Cases</h1>
          <p className="text-sm text-muted-foreground">
            Jeder Fall zeigt die nachvollziehbare Spur von Source Truth bis Release Truth.
          </p>
        </div>

        {isLoading && <LoadingIndicator message="Lade Fälle…" size="sm" variant="dots" />}
        {error && <ErrorBox message="Fälle konnten nicht geladen werden." onRetry={() => refetch()} />}

        {!isLoading && !error && items.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Noch keine normalisierten Fälle vorhanden.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLocation(`/cases/${item.id}`)}
              className="w-full text-left"
            >
              <Card className="transition-colors hover:border-primary/30 hover:bg-primary/5">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-medium truncate">{item.title}</p>
                      {releaseBadge(item.release_status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.source_system ?? "Unknown source"} · {item.category}
                    </p>
                    {item.conflict_count > 0 && (
                      <div className="flex items-center gap-1 text-xs text-amber-600 mt-2">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {item.conflict_count} Konflikt{item.conflict_count === 1 ? "" : "e"}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </Layout>
  );
}

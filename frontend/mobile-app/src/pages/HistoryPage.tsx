import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ErrorBox } from "@/components/ErrorBox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { milaApi, type AnalysisResult } from "@/api/connector";
import { formatDate, formatSource } from "@/utils/formatters";
import { downloadMarkdown, printAsPdf, type ExportData } from "@/lib/export";
import {
  ArrowLeft, Trash2, Eye, ChevronLeft, ChevronRight,
  Clock, BrainCircuit, List, Search, X, Download,
  FileText, FileType,
} from "lucide-react";

const PAGE_SIZE = 10;

interface HistoryItem {
  id: number;
  created_at: string;
  business_name: string;
  industry: string;
  source: string;
}

interface HistoryDetail extends HistoryItem {
  input_json: Record<string, unknown>;
  output_json: AnalysisResult;
}

function buildExportData(item: HistoryDetail): ExportData {
  const out = item.output_json;
  return {
    business_name: item.business_name,
    industry: item.industry,
    created_at: item.created_at,
    source: item.source,
    result: {
      note: out.note,
      summary: out.summary,
      insights: out.insights,
      risks: out.risks,
      opportunities: out.opportunities,
      recommendations: out.recommendations,
      automation_allowed: out.automation_allowed,
    },
  };
}

export default function HistoryPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<HistoryDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["history", offset],
    queryFn: () => milaApi.history(PAGE_SIZE, offset),
  });

  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["history-detail", detailId],
    queryFn: () => milaApi.historyItem(detailId!),
    enabled: detailId !== null,
  });

  const openDetail = (id: number) => {
    setDetailId(id);
    setSelected(null);
  };

  if (detail && detail.id === detailId && selected?.id !== detailId) {
    setSelected(detail as unknown as HistoryDetail);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => milaApi.deleteHistory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
      if (selected?.id === detailId) {
        setSelected(null);
        setDetailId(null);
      }
    },
  });

  const allItems: HistoryItem[] = data?.items ?? [];

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.business_name.toLowerCase().includes(q) ||
        item.industry.toLowerCase().includes(q),
    );
  }, [allItems, searchQuery]);

  const hasNext = allItems.length === PAGE_SIZE && !searchQuery;
  const hasPrev = offset > 0 && !searchQuery;

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    setOffset(0);
  };

  // ── Detail panel ─────────────────────────────────────────────────────────
  if (selected) {
    const out = selected.output_json;
    const exportData = buildExportData(selected);

    return (
      <Layout>
        <div className="max-w-3xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-10">

          {/* Back + actions row */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={() => { setSelected(null); setDetailId(null); }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Zurück zur Liste
            </Button>

            <div className="flex items-center gap-2">
              {/* Export dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1.5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Format wählen
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => downloadMarkdown(exportData)}>
                    <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                    Als Markdown (.md)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => printAsPdf(exportData)}>
                    <FileType className="h-4 w-4 mr-2 text-muted-foreground" />
                    Als PDF drucken
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Delete */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Analyse löschen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Diese Analyse wird dauerhaft gelöscht und kann nicht wiederhergestellt werden.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate(selected.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Löschen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <h1 className="text-2xl font-serif text-primary">{selected.business_name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {formatDate(selected.created_at)}
              <span className="text-border">·</span>
              <span>{selected.industry}</span>
              <Badge variant="outline" className="text-xs">
                {formatSource(selected.source)}
              </Badge>
            </div>
          </div>

          {/* Mila's note */}
          {out.note && (
            <div className="bg-primary/5 border border-primary/10 rounded-lg px-5 py-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-lg" />
              <p className="font-serif italic text-primary/80 leading-relaxed">"{out.note}"</p>
            </div>
          )}

          <p className="text-muted-foreground leading-relaxed">{out.summary}</p>

          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title="Erkenntnisse" items={out.insights} bullet="text-primary" />
            <SectionCard title="Risiken" items={out.risks} bullet="text-destructive" />
          </div>
          <SectionCard title="Chancen" items={out.opportunities} bullet="text-amber-500" />

          <div>
            <h3 className="font-serif text-lg text-primary mb-3">Empfehlungen</h3>
            <div className="space-y-2">
              {out.recommendations.map((rec: string, i: number) => (
                <div
                  key={i}
                  className="flex gap-3 bg-card border border-border/50 rounded-lg p-3 shadow-sm"
                >
                  <div className="shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold font-serif">
                    {i + 1}
                  </div>
                  <p className="text-sm text-foreground/90 pt-0.5 leading-relaxed">{rec}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ── List panel ───────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-3xl mx-auto w-full space-y-5">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Neue Analyse
          </Button>
        </div>

        <div className="space-y-1">
          <h1 className="text-3xl font-serif text-primary">Analyse-Verlauf</h1>
          <p className="text-muted-foreground text-sm">
            Alle bisherigen Diagnosen — klicke auf einen Eintrag um Details zu sehen.
          </p>
        </div>

        {/* Live search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Name oder Branche suchen…"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Suche löschen"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {isLoading && <LoadingIndicator message="Lade Verlauf…" size="sm" variant="dots" />}
        {error && (
          <ErrorBox
            message="Verlauf konnte nicht geladen werden."
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && allItems.length === 0 && !error && (
          <div className="text-center py-16 text-muted-foreground">
            <List className="h-10 w-10 mx-auto mb-4 opacity-30" />
            <p className="font-medium mb-1">Noch keine Analysen gespeichert</p>
            <p className="text-sm mb-4">Starte deine erste Diagnose und sie erscheint hier.</p>
            <Button onClick={() => setLocation("/")}>Erste Analyse starten</Button>
          </div>
        )}

        {!isLoading && allItems.length > 0 && filteredItems.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Keine Einträge für <span className="font-medium">„{searchQuery}"</span>.</p>
            <button
              className="text-xs text-primary mt-2 hover:underline"
              onClick={() => handleSearch("")}
            >
              Suche zurücksetzen
            </button>
          </div>
        )}

        {filteredItems.length > 0 && (
          <div className="space-y-2">
            {searchQuery && (
              <p className="text-xs text-muted-foreground pb-1">
                {filteredItems.length} Ergebnis{filteredItems.length !== 1 ? "se" : ""} für „{searchQuery}"
              </p>
            )}

            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 bg-card border border-border/50 rounded-lg px-4 py-3 shadow-sm hover:border-primary/30 hover:bg-primary/5 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm md:text-base">{item.business_name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground truncate">{item.industry}</span>
                    <span className="text-muted-foreground/40 text-xs">·</span>
                    <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                  </div>
                </div>

                <Badge variant="outline" className="shrink-0 text-xs gap-1 hidden sm:flex">
                  {item.source === "ai"
                    ? <><BrainCircuit className="h-3 w-3" /> AI</>
                    : <><List className="h-3 w-3" /> Regel</>
                  }
                </Badge>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => openDetail(item.id)}
                    disabled={detailLoading && detailId === item.id}
                    title="Details anzeigen"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Analyse löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Diese Analyse wird dauerhaft gelöscht und kann nicht wiederhergestellt werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(item.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!searchQuery && (hasPrev || hasNext) && (
          <>
            <Separator className="opacity-40" />
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset(offset - PAGE_SIZE)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
              </Button>
              <span className="text-xs text-muted-foreground">
                Seite {Math.floor(offset / PAGE_SIZE) + 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Weiter <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function SectionCard({ title, items, bullet }: { title: string; items: string[]; bullet: string }) {
  if (!items?.length) return null;
  return (
    <Card className="bg-card shadow-sm border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-serif text-primary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className={`mt-0.5 shrink-0 ${bullet}`}>•</span>
              <span className="text-foreground/90 leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
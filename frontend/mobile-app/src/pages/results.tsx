import { useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle, ArrowLeft, CheckCircle2, Lightbulb,
  Target, Zap, Download, FileText, FileType,
} from "lucide-react";
import { downloadMarkdown, printAsPdf, type ExportData } from "@/lib/export";

export default function Results() {
  const [, setLocation] = useLocation();
  const { result, profile } = useStore();

  useEffect(() => {
    if (!result) setLocation("/");
  }, [result, setLocation]);

  if (!result) return null;

  const handleExport = (format: "md" | "pdf") => {
    const exportData: ExportData = {
      business_name: profile?.business_name ?? "Unbekannt",
      industry: profile?.industry ?? "Unbekannt",
      created_at: new Date().toISOString(),
      source: "rule",
      result: {
        note: result.note,
        summary: result.summary,
        insights: result.insights,
        risks: result.risks,
        opportunities: result.opportunities,
        recommendations: result.recommendations,
        automation_allowed: result.automation_allowed,
      },
    };
    if (format === "md") downloadMarkdown(exportData);
    else printAsPdf(exportData);
  };

  return (
    <Layout>
      <div className="w-full space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pb-12">

        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border/50 pb-6">
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="-ml-3 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Zurück
            </Button>

            <div className="flex items-center gap-2">
              {result.automation_allowed && (
                <Badge variant="secondary" className="bg-accent/10 text-accent-foreground border-accent/20">
                  <Zap className="h-3 w-3 mr-1 text-accent" /> Automatisierung aktiv
                </Badge>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1.5" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Format wählen
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("md")}>
                    <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                    Als Markdown (.md)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")}>
                    <FileType className="h-4 w-4 mr-2 text-muted-foreground" />
                    Als PDF drucken
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="space-y-2 max-w-3xl">
            <h1 className="text-2xl md:text-3xl font-serif text-primary">Diagnose-Bericht</h1>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              {result.summary}
            </p>
          </div>
        </div>

        {/* Note from Mila */}
        {result.note && (
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-lg" />
            <p className="font-serif italic text-base md:text-lg text-primary/80 leading-relaxed">
              "{result.note}"
            </p>
          </div>
        )}

        {/* Insights + Risks */}
        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-primary font-serif text-base md:text-lg">
                <Lightbulb className="h-4 w-4 md:h-5 md:w-5 text-accent shrink-0" /> Erkenntnisse
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {result.insights.map((item: string, i: number) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-accent mt-0.5 shrink-0">•</span>
                    <span className="text-foreground/90 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-primary font-serif text-base md:text-lg">
                <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-destructive shrink-0" /> Risiken
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {result.risks.map((item: string, i: number) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-destructive mt-0.5 shrink-0">•</span>
                    <span className="text-foreground/90 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Separator className="opacity-40" />

        {/* Opportunities */}
        <div>
          <h2 className="text-xl md:text-2xl font-serif text-primary flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 md:h-6 md:w-6 text-accent shrink-0" /> Chancen
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {result.opportunities.map((item: string, i: number) => (
              <div
                key={i}
                className="bg-secondary/40 border border-border/50 rounded-lg p-4 text-sm text-foreground/90 leading-relaxed hover:border-primary/20 transition-colors"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        <div>
          <h2 className="text-xl md:text-2xl font-serif text-primary flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-5 w-5 md:h-6 md:w-6 shrink-0" /> Empfehlungen
          </h2>
          <div className="space-y-2.5">
            {result.recommendations.map((item: string, i: number) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-card border border-border/50 rounded-lg p-3 md:p-4 shadow-sm hover:border-primary/20 transition-colors"
              >
                <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold font-serif">
                  {i + 1}
                </div>
                <p className="text-sm text-foreground/90 pt-0.5 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}
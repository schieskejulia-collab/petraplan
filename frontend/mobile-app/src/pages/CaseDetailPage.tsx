import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ErrorBox } from "@/components/ErrorBox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { milaApi } from "@/api/connector";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  CircleDot,
  FileSearch,
  GitBranch,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Stage({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute left-0 top-0 h-full w-1 bg-primary/70" />
      <CardHeader className="pb-3 pl-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">{icon}</div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pl-5 pt-0">{children}</CardContent>
    </Card>
  );
}

export default function CaseDetailPage() {
  const [, params] = useRoute("/cases/:caseId");
  const [, setLocation] = useLocation();
  const caseId = params?.caseId ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["petraplan-case", caseId],
    queryFn: () => milaApi.caseTrace(caseId),
    enabled: Boolean(caseId),
  });

  if (isLoading) {
    return <Layout><LoadingIndicator message="Lade Truth Trace…" size="sm" variant="dots" /></Layout>;
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto w-full space-y-4">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setLocation("/cases")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Fälle
          </Button>
          <ErrorBox message="Truth Trace konnte nicht geladen werden." onRetry={() => refetch()} />
        </div>
      </Layout>
    );
  }

  const latestCertificate = data.release.certificates.at(-1) as Record<string, unknown> | undefined;
  const latestReleaseHistory = data.release.status_history.at(-1) as Record<string, unknown> | undefined;
  const releaseStatus = String(latestReleaseHistory?.new_status ?? latestCertificate?.release_status ?? "open");

  return (
    <Layout>
      <div className="max-w-3xl mx-auto w-full space-y-5 pb-12">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/cases")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Fälle
        </Button>

        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-serif text-primary">{data.title}</h1>
            {releaseStatus === "trusted" ? (
              <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> TRUSTED</Badge>
            ) : (
              <Badge variant="outline">{releaseStatus.toUpperCase()}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{data.category} · Case {data.id.slice(0, 8)}</p>
        </div>

        <Stage title="Source Truth" subtitle="Unveränderte Herkunft und Referenz" icon={<FileSearch className="h-4 w-4" />}>
          <p className="text-sm">Source: {String(data.source.record.source_system ?? data.source.ingestion?.source_system ?? "unknown")}</p>
          {data.source.ingestion && <JsonBlock value={data.source.ingestion} />}
        </Stage>

        <Stage title="Semantic Truth" subtitle="Bedeutung und normalisierte Interpretation" icon={<Braces className="h-4 w-4" />}>
          <p className="text-sm leading-relaxed">{data.semantic.meaning}</p>
          <JsonBlock value={{ metadata: data.semantic.metadata, extracted_schema: data.semantic.extracted_schema }} />
        </Stage>

        <Stage title="Conflict Truth" subtitle="Abweichungen bleiben sichtbar und werden nicht automatisch zusammengeführt" icon={<TriangleAlert className="h-4 w-4" />}>
          <p className="text-sm">{count(data.conflict.conflicts)} Konflikt(e), {count(data.conflict.sources)} beteiligte Source-Einträge</p>
          {count(data.conflict.conflicts) > 0 && <JsonBlock value={data.conflict} />}
        </Stage>

        <Stage title="Execution Truth" subtitle="Welche Operation den Fall untersucht hat" icon={<PlayCircle className="h-4 w-4" />}>
          <p className="text-sm">{count(data.execution.operations)} Operation(en)</p>
          {count(data.execution.operations) > 0 && <JsonBlock value={data.execution.operations} />}
        </Stage>

        <Stage title="Runtime Truth" subtitle="Technische Beobachtungen und Laufzeitdiagnostik" icon={<CircleDot className="h-4 w-4" />}>
          <p className="text-sm">{count(data.runtime.observations)} Runtime-Eintrag/Einträge</p>
          {count(data.runtime.observations) > 0 && <JsonBlock value={data.runtime.observations} />}
        </Stage>

        <Stage title="Resolution Truth" subtitle="Nachvollziehbare Entscheidung ohne Löschen der vorherigen Wahrheit" icon={<GitBranch className="h-4 w-4" />}>
          <p className="text-sm">{count(data.resolution.records)} Resolution Record(s)</p>
          {count(data.resolution.records) > 0 && <JsonBlock value={data.resolution} />}
        </Stage>

        <Stage title="Validation Truth" subtitle="Belegt, ob die Resolution zur Evidenz passt" icon={<CheckCircle2 className="h-4 w-4" />}>
          <p className="text-sm">{count(data.validation.results)} Validation Result(s)</p>
          {count(data.validation.results) > 0 && <JsonBlock value={data.validation.results} />}
        </Stage>

        <Stage title="Review Truth" subtitle="Autorisierte Prüfung, Kriterien und finale Entscheidung" icon={<UserCheck className="h-4 w-4" />}>
          <p className="text-sm">
            {count(data.review.criteria)} Kriterien · {count(data.review.decisions)} Entscheidung(en)
          </p>
          {(count(data.review.records) > 0 || count(data.review.decisions) > 0) && <JsonBlock value={data.review} />}
        </Stage>

        <Stage title="Release Truth" subtitle="Freigabestatus und unveränderliches Zertifikat" icon={<ScrollText className="h-4 w-4" />}>
          {latestCertificate ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Status: {releaseStatus}</p>
              <p className="text-xs text-muted-foreground break-all">
                Certificate hash: {String(latestCertificate.certificate_hash ?? "n/a")}
              </p>
              <JsonBlock value={{ certificate: latestCertificate, status_history: data.release.status_history }} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Noch kein Release-Zertifikat.</p>
          )}
        </Stage>
      </div>
    </Layout>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Database, Eye, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getIngestion, listIngestions, type IngestionLogDetail, type IngestionStatus } from '@/api/ingestions';

function statusLabel(status: IngestionStatus) {
  if (status === 'processed') return 'Verarbeitet';
  if (status === 'error') return 'Fehler';
  return 'Ausstehend';
}

function statusVariant(status: IngestionStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'processed') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

function StringList({ title, value }: { title: string; value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {value.map((item, index) => (
            <li key={`${title}-${index}`} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              {typeof item === 'string' ? item : JSON.stringify(item)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DetailView({ item, onBack }: { item: IngestionLogDetail; onBack: () => void }) {
  const schema = item.extracted_schema ?? {};
  const reviewRequired = schema.review_required === true;

  return (
    <Layout>
      <div className="mx-auto w-full max-w-4xl space-y-5 pb-10">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Zurück
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-serif text-primary">{item.source_system}</h1>
            <p className="text-sm text-muted-foreground">{new Date(item.created_at).toLocaleString('de-DE')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
            {reviewRequired && <Badge variant="outline">Review erforderlich</Badge>}
          </div>
        </div>

        {item.error_message && (
          <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
            <span>{item.error_message}</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Originaldaten</CardTitle></CardHeader>
          <CardContent><JsonBlock value={item.raw_payload} /></CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Feld-Mapping</CardTitle></CardHeader>
            <CardContent><JsonBlock value={schema.fieldMapping ?? {}} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Datentypen</CardTitle></CardHeader>
            <CardContent><JsonBlock value={schema.field_types ?? {}} /></CardContent>
          </Card>
        </div>

        <StringList title="Geschäftsregeln" value={schema.business_rules} />
        <StringList title="Zustandsübergänge" value={schema.state_transitions} />
        <StringList title="Operationen / Verhalten" value={schema.operations} />
        <StringList title="Kommunikationsverträge" value={schema.communication_contracts} />
        <StringList title="Belege" value={schema.evidence} />
        <StringList title="Warnungen" value={schema.warnings} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> SQL-Vorschlag — nur Vorschau
            </CardTitle>
          </CardHeader>
          <CardContent>
            <JsonBlock value={schema.schema_sql ?? []} />
            <p className="mt-2 text-xs text-muted-foreground">
              Dieser Bereich führt nichts aus. SQL bleibt bis zur ausdrücklichen Freigabe reine Vorschau.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

export default function IngestionPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['ingestions'],
    queryFn: () => listIngestions(50),
  });

  const detailQuery = useQuery({
    queryKey: ['ingestion', selectedId],
    queryFn: () => getIngestion(selectedId!),
    enabled: selectedId !== null,
  });

  if (selectedId && detailQuery.data) {
    return <DetailView item={detailQuery.data} onBack={() => setSelectedId(null)} />;
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-4xl space-y-5 pb-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-serif text-primary">Legacy-Ingestion</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Importstatus, extrahierte Struktur und prüfbare SQL-Vorschau.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
            Neu laden
          </Button>
        </div>

        <Separator />

        {listQuery.isLoading && <p className="text-sm text-muted-foreground">Ingestion-Logs werden geladen …</p>}
        {listQuery.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {listQuery.error instanceof Error ? listQuery.error.message : 'Ingestion-Logs konnten nicht geladen werden.'}
          </div>
        )}

        {!listQuery.isLoading && !listQuery.error && (listQuery.data?.length ?? 0) === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Ingestion-Läufe vorhanden.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {listQuery.data?.map((item) => {
            const schema = item.extracted_schema ?? {};
            const warnings = Array.isArray(schema.warnings) ? schema.warnings.length : 0;
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.source_system}</span>
                      <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                      {schema.review_required === true && <Badge variant="outline">Review</Badge>}
                      {warnings > 0 && <Badge variant="secondary">{warnings} Warnung{warnings === 1 ? '' : 'en'}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('de-DE')}</p>
                    {item.error_message && <p className="line-clamp-2 text-xs text-destructive">{item.error_message}</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(item.id)}>
                    <Eye className="mr-1.5 h-4 w-4" /> Prüfen
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {selectedId && detailQuery.isLoading && <p className="text-sm text-muted-foreground">Details werden geladen …</p>}
      </div>
    </Layout>
  );
}

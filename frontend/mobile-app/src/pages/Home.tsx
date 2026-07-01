import { useLocation } from "wouter";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAnalyzeBusinessProfile } from "@workspace/api-client-react";
import { useStore } from "@/lib/store";
import { Layout } from "@/components/layout";
import { PremiumSwitch } from "@/components/PremiumSwitch";
import { YesSwitch } from "@/components/YesSwitch";
import { IndustryInsightCard } from "@/components/IndustryInsightCard";
import { useIndustryInsight } from "@/hooks/useIndustryInsight";
import { useToast } from "@/hooks/use-toast";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ArrowRight, Upload, Cpu, HelpCircle } from "lucide-react";

const formSchema = z.object({
  business_name: z.string().min(1, "Business name is required"),
  industry: z.string().min(1, "Industry is required"),
  team_size: z.coerce.number().nullable().optional(),
  tools: z.string().optional(),
  workflows: z.string().nullable().optional(),
  repeated_tasks: z.string().nullable().optional(),
  time_wasters: z.string().nullable().optional(),
  top_priority: z.string().nullable().optional(),
  desired_outcome: z.string().nullable().optional(),
  premium_active: z.boolean().default(false),
  user_yes_for_automation: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

function FieldHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { setResult, setProfile } = useStore();
  const { toast } = useToast();
  const analyzeMutation = useAnalyzeBusinessProfile();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      business_name: "", industry: "", team_size: undefined,
      tools: "", workflows: "", repeated_tasks: "",
      time_wasters: "", top_priority: "", desired_outcome: "",
      premium_active: false, user_yes_for_automation: false,
    },
  });

  const watchedIndustry = useWatch({ control: form.control, name: "industry" });
  const watchedTools = useWatch({ control: form.control, name: "tools" });
  const watchedWorkflows = useWatch({ control: form.control, name: "workflows" });
  const watchedTasks = useWatch({ control: form.control, name: "repeated_tasks" });
  const watchedWasters = useWatch({ control: form.control, name: "time_wasters" });

  const toolsArray = (watchedTools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const extraText = [watchedWorkflows, watchedTasks, watchedWasters].filter(Boolean).join(" ");

  const { insight, loading: insightLoading } = useIndustryInsight(
    watchedIndustry ?? "",
    toolsArray,
    extraText,
  );

  const buildProfile = (data: FormValues) => ({
    ...data,
    tools: data.tools ? data.tools.split(",").map((t) => t.trim()).filter(Boolean) : [],
  });

  const onSubmit = (data: FormValues) => {
    const profile = buildProfile(data);
    setProfile(profile);
    analyzeMutation.mutate({ data: profile }, {
      onSuccess: (result) => {
        setResult(result);
        setLocation("/results");
      },
      onError: (error) => {
        toast({
          title: "Analyse fehlgeschlagen",
          description: (error as { error?: string }).error ?? "Ein Fehler ist aufgetreten. Bitte erneut versuchen.",
          variant: "destructive",
        });
      },
    });
  };

  const goToAnalyze = () => {
    const data = form.getValues();
    setProfile(buildProfile(data));
    setLocation("/analyze");
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto w-full">

        {/* Hero */}
        <div className="mb-8 md:mb-10 text-center space-y-3">
          <h1 className="text-3xl md:text-5xl font-serif text-primary leading-tight">
            Versteh dein Unternehmen.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            Beschreib mir dein Business — ich finde die Engpässe und sage dir genau, was du reparieren oder automatisieren kannst.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setLocation("/upload")}>
              <Upload className="h-4 w-4 mr-1.5" /> Datei hochladen
            </Button>
            <Button variant="outline" size="sm" onClick={goToAnalyze}>
              <Cpu className="h-4 w-4 mr-1.5" /> KI-Modus wählen
            </Button>
          </div>
        </div>

        <Card className="border border-border/50 shadow-sm bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-6 px-4 md:px-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-7">

                {/* Identity */}
                <div className="space-y-5">
                  <div className="grid md:grid-cols-2 gap-5">
                    <FormField control={form.control} name="business_name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unternehmensname</FormLabel>
                        <FormControl>
                          <Input placeholder="Acme GmbH" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="industry" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Branche</FormLabel>
                          <FieldHint text="Beschreib deine Branche frei — Mila erkennt sie automatisch und zeigt passende Tools, Automatisierungen und Integrationsmöglichkeiten." />
                        </div>
                        <FormControl>
                          <Input placeholder="Reinigung, Pflege, Handwerk…" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid md:grid-cols-2 gap-5">
                    <FormField control={form.control} name="team_size" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Teamgröße</FormLabel>
                          <FieldHint text="Anzahl der Personen inkl. dir selbst. Beeinflusst die Empfehlungen zur Koordination und Delegation." />
                        </div>
                        <FormControl>
                          <Input type="number" min={1} placeholder="z.B. 5" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="tools" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Tools & Software</FormLabel>
                          <FieldHint text="Alle genutzten Programme, Apps oder Plattformen — auch Excel, WhatsApp, Papier. Mila erkennt Legacy-Tools und empfiehlt Alternativen." />
                        </div>
                        <FormControl>
                          <Input placeholder="Excel, WhatsApp, Shiftbase…" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">Komma-getrennt</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Live industry insight */}
                  <IndustryInsightCard insight={insight} loading={insightLoading} />
                </div>

                {/* Operations */}
                <div className="border-t border-border/40 pt-6 space-y-5">
                  <h3 className="font-serif text-lg md:text-xl text-primary">Abläufe & Zeitfresser</h3>

                  <FormField control={form.control} name="workflows" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FormLabel className="mb-0">Hauptworkflow</FormLabel>
                        <FieldHint text="Beschreib Schritt für Schritt, wie ein typischer Auftrag oder Kundenvorgang bei dir abläuft. Je konkreter, desto besser die Empfehlungen." />
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="Ein Kunde bucht → wir übertragen manuell in die Tabelle → schicken Bestätigung per WhatsApp…"
                          className="min-h-[90px] resize-none"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid md:grid-cols-2 gap-5">
                    <FormField control={form.control} name="repeated_tasks" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Täglich wiederkehrende Aufgaben</FormLabel>
                          <FieldHint text="Aufgaben, die du oder dein Team jeden Tag oder jede Woche manuell erledigen — diese sind die besten Automatisierungskandidaten." />
                        </div>
                        <FormControl>
                          <Input placeholder="Schichtplan, Rechnungen, E-Mails…" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="time_wasters" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Größte Zeitfresser</FormLabel>
                          <FieldHint text="Aktivitäten, die unverhältnismäßig viel Zeit kosten oder Fehler verursachen — z.B. manuelle Datenpflege, Telefonate für Terminabsagen." />
                        </div>
                        <FormControl>
                          <Input placeholder="Telefonisches Absagen, Suche nach Infos…" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                {/* Goals */}
                <div className="border-t border-border/40 pt-6 space-y-5">
                  <h3 className="font-serif text-lg md:text-xl text-primary">Ziele</h3>
                  <div className="grid md:grid-cols-2 gap-5">
                    <FormField control={form.control} name="top_priority" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Aktuelle Top-Priorität</FormLabel>
                          <FieldHint text="Das eine Ziel, das gerade alles andere überwiegt — z.B. Kosten senken, mehr Aufträge, weniger Überstunden. Mila richtet alle Empfehlungen danach aus." />
                        </div>
                        <FormControl>
                          <Input placeholder="Mehr Aufträge, Kosten senken…" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="desired_outcome" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FormLabel className="mb-0">Ziel in 6 Monaten</FormLabel>
                          <FieldHint text="Wo soll dein Unternehmen in einem halben Jahr stehen? Konkrete Ziele helfen Mila, die Dringlichkeit der Empfehlungen zu priorisieren." />
                        </div>
                        <FormControl>
                          <Input placeholder="Vollautomatisiertes Onboarding…" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                {/* Premium toggles */}
                <div className="border-t border-border/40 pt-6 space-y-4 bg-muted/20 p-5 rounded-xl">
                  <FormField control={form.control} name="premium_active" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <PremiumSwitch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="user_yes_for_automation" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <YesSwitch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <div className="flex justify-end pt-2 pb-1">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full md:w-auto min-w-[200px]"
                    disabled={analyzeMutation.isPending}
                  >
                    {analyzeMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analysiere…</>
                    ) : (
                      <>Diagnose starten <ArrowRight className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
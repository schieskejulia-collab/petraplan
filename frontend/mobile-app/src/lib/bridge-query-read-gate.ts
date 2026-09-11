import type { QueryTranslationPlan } from "./bridge-query-abstraction";
import type { ReadAccessDecision } from "./bridge-read-access-decision";

export type QueryReadGateStatus =
  | "ready"
  | "refresh_required"
  | "needs_confirmation"
  | "blocked";

export type QueryReadGateDecision = {
  status: QueryReadGateStatus;
  executable: boolean;
  executableQueryText: string | null;
  parameters: string[];
  blockers: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  semanticPolicy: "canonical_intent_before_dialect";
  executionPolicy: "query_only_after_read_and_translation_ready";
  note: string;
};

/**
 * Final conservative gate between a translated query representation and its
 * actual use for a read.
 *
 * A technically renderable query is not executable merely because dialect and
 * mappings are known. The read-access gate must also be ready, which means the
 * source, targeted read path and freshness conditions have already passed.
 * When refresh is required, the translated representation stays evidence only
 * and is not released as an executable query until the source has been read
 * again under the confirmed read-only plan.
 */
export function decideQueryReadExecution(input: {
  readAccess: ReadAccessDecision;
  queryPlan: QueryTranslationPlan;
}): QueryReadGateDecision {
  const { readAccess, queryPlan } = input;
  const blockers: string[] = [];

  if (readAccess.status === "blocked") {
    blockers.push("Der Read-Access-Gate ist blockiert; keine technische Query wird zur Nutzung freigegeben.");
  } else if (readAccess.status === "refresh_required") {
    blockers.push("Der Lesestand muss zuerst über den bestätigten read-only Pfad aktualisiert werden.");
  } else if (readAccess.status === "needs_confirmation") {
    blockers.push("Der Read-Access-Gate enthält noch unbestätigte Voraussetzungen.");
  }

  if (queryPlan.status === "blocked") {
    blockers.push("Die Query-Übersetzung ist blockiert.");
  } else if (queryPlan.status === "needs_confirmation") {
    blockers.push("Dialekt, Zieladresse, Mapping oder fachliche Query-Absicht sind noch nicht vollständig bestätigt.");
  }

  if (queryPlan.status === "ready" && !queryPlan.queryText) {
    blockers.push("Die Query-Übersetzung meldet ready, enthält aber keinen technischen Query-Text.");
  }

  let status: QueryReadGateStatus;
  if (readAccess.status === "blocked" || queryPlan.status === "blocked") {
    status = "blocked";
  } else if (readAccess.status === "refresh_required") {
    status = "refresh_required";
  } else if (readAccess.status !== "ready" || queryPlan.status !== "ready" || !queryPlan.queryText) {
    status = "needs_confirmation";
  } else {
    status = "ready";
  }

  const executable = status === "ready";
  const executableQueryText = executable ? queryPlan.queryText : null;
  const parameters = executable ? [...queryPlan.parameters] : [];

  const evidence = [
    ...readAccess.evidence,
    ...queryPlan.evidence,
    `read-access:${readAccess.status}`,
    `query-translation:${queryPlan.status}:${queryPlan.dialect}`,
  ];

  let note: string;
  if (status === "ready") {
    note = "Die technische Query ist zur read-only Nutzung freigegeben: Read-Access, fachliche Query-Absicht, Mapping und Dialekt sind gemeinsam bestätigt.";
  } else if (status === "refresh_required") {
    note = "Die Query-Repräsentation kann technisch bekannt sein, wird aber nicht ausgeführt, bevor der veraltete Lesestand über den bestätigten read-only Pfad aktualisiert wurde.";
  } else if (status === "needs_confirmation") {
    note = "Mindestens eine Voraussetzung aus Read-Access oder Query-Übersetzung ist noch unbestätigt; PetraPlan gibt keinen ausführbaren Query-Text frei.";
  } else {
    note = "Quelle, Lesepfad oder Query-Übersetzung ist blockiert; es wird kein ausführbarer Query-Text freigegeben.";
  }

  return {
    status,
    executable,
    executableQueryText,
    parameters,
    blockers,
    evidence,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    semanticPolicy: "canonical_intent_before_dialect",
    executionPolicy: "query_only_after_read_and_translation_ready",
    note,
  };
}

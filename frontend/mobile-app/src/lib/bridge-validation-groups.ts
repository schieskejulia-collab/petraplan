import type { ConstraintCategory, ConstraintResult } from "./bridge-constraints";

export type ValidationGroup = {
  id: ConstraintCategory;
  label: string;
  constraintIds: string[];
  passed: boolean;
  blockingIssues: number;
  warningIssues: number;
};

const groupDefinitions: ReadonlyArray<{
  id: ConstraintCategory;
  label: string;
}> = [
  { id: "transport", label: "Transport" },
  { id: "contract", label: "Vertrag und Schema" },
  { id: "semantics", label: "Bedeutung und Value-Maps" },
  { id: "data", label: "Daten und Formate" },
];

export function groupConstraints(results: readonly ConstraintResult[]): ValidationGroup[] {
  return groupDefinitions.flatMap(({ id, label }) => {
    const members = results
      .filter((constraint) => constraint.category === id)
      .sort((a, b) => a.sequence - b.sequence);

    if (members.length === 0) return [];

    return [{
      id,
      label,
      constraintIds: members.map(({ id: constraintId }) => constraintId),
      passed: members.every(({ passed }) => passed),
      blockingIssues: members.filter(({ passed, severity }) => !passed && severity === "blocking").length,
      warningIssues: members.filter(({ passed, severity }) => !passed && severity === "warning").length,
    }];
  });
}

import type {
  ComponentProfileEntry,
  ConfirmedInstanceProfile,
  EvidenceStatus,
} from "./bridge-instance-profile";

export type ComponentEvidence = {
  componentId: string;
  ownerEntity: string;
  componentType: string;
  fields: Array<{
    field: string;
    value?: string | null;
    status?: EvidenceStatus;
  }>;
  definitionStatus: EvidenceStatus;
  evidence: string[];
};

/**
 * Describes an embedded/component-like field group without inventing a
 * separate entity identity.
 *
 * A component may carry coherent business meaning as a group of fields, but
 * it is explicitly not treated as an independently identifiable entity here.
 * Missing or candidate fields keep the component conservative.
 */
export function assessComponent(input: ComponentEvidence): ComponentProfileEntry {
  const fields = input.fields.map(({ field, value = null, status }) => ({
    field,
    value,
    status: status ?? (value === null || value === "" ? "unresolved" : "candidate"),
  }));

  const hasFields = fields.length > 0;
  const allFieldsConfirmed = hasFields && fields.every(({ status }) => status === "confirmed");

  let status: EvidenceStatus = "unresolved";
  if (hasFields) {
    status = input.definitionStatus === "confirmed" && allFieldsConfirmed
      ? "confirmed"
      : "candidate";
  }

  const blockers: string[] = [];
  if (!hasFields) blockers.push("Für die Komponente wurden keine Felder beobachtet.");
  if (input.definitionStatus !== "confirmed") {
    blockers.push("Die fachliche Definition der Feldgruppe als Komponente ist nicht bestätigt.");
  }
  for (const field of fields.filter(({ status }) => status !== "confirmed")) {
    blockers.push(`Komponentenfeld ${field.field} ist ${field.status}.`);
  }

  return {
    componentId: input.componentId,
    ownerEntity: input.ownerEntity,
    componentType: input.componentType,
    status,
    hasOwnIdentity: false,
    fields,
    evidence: [...input.evidence],
    blockers,
    note: status === "confirmed"
      ? `Die Feldgruppe ${input.componentType} ist als Bestandteil von ${input.ownerEntity} bestätigt. Sie trägt gemeinsame Bedeutung, aber keine eigene Identität.`
      : status === "candidate"
        ? `Die Feldgruppe passt zu ${input.componentType}, aber Definition oder einzelne Felder sind noch nicht vollständig bestätigt. Keine eigene Entität wird daraus abgeleitet.`
        : `Für ${input.componentType} liegen nicht genug Belege vor, um eine Komponente zu bestätigen.`,
  };
}

export function attachComponent(
  profile: ConfirmedInstanceProfile,
  component: ComponentProfileEntry,
): ConfirmedInstanceProfile {
  return {
    ...profile,
    components: [
      ...profile.components.filter(({ componentId }) => componentId !== component.componentId),
      component,
    ],
  };
}

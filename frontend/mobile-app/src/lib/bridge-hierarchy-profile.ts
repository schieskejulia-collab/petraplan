import type {
  ConfirmedInstanceProfile,
  EvidenceStatus,
  HierarchyProfileEntry,
} from "./bridge-instance-profile";

export type HierarchyNode = {
  id: string;
  parentId: string | null;
};

export type HierarchyEvidence = {
  relationId: string;
  entity: string;
  nodeIdField: string;
  parentIdField: string;
  definitionStatus: EvidenceStatus;
  startId: string;
  nodes: HierarchyNode[];
  maxDepth?: number;
  evidence: string[];
};

/**
 * Reads a recursive parent relation conservatively and with a hard depth bound.
 *
 * A hierarchy is confirmed only when the recursive definition is confirmed and
 * the observed chain can be followed to a root without a missing parent, cycle
 * or depth-limit hit. Cycles are reported explicitly rather than followed
 * indefinitely. The traversal is read-only and never repairs source links.
 */
export function assessHierarchy(input: HierarchyEvidence): HierarchyProfileEntry {
  const maxDepth = Math.max(1, input.maxDepth ?? 32);
  const nodeMap = new Map(input.nodes.map((node) => [node.id, node]));
  const observedPath: string[] = [];
  const visited = new Set<string>();
  const blockers: string[] = [];

  let currentId: string | null = input.startId;
  let traversalStatus: HierarchyProfileEntry["traversalStatus"] = "unresolved";
  let cycleDetected = false;

  for (let depth = 0; depth < maxDepth && currentId !== null; depth += 1) {
    if (visited.has(currentId)) {
      cycleDetected = true;
      traversalStatus = "cycle_detected";
      blockers.push(`Zyklus erkannt: ${currentId} wurde innerhalb derselben Hierarchiekette erneut erreicht.`);
      break;
    }

    visited.add(currentId);
    observedPath.push(currentId);

    const node = nodeMap.get(currentId);
    if (!node) {
      traversalStatus = "missing_parent";
      blockers.push(`Der referenzierte Hierarchieknoten ${currentId} wurde nicht beobachtet.`);
      break;
    }

    if (node.parentId === null) {
      traversalStatus = "complete";
      currentId = null;
      break;
    }

    currentId = node.parentId;
  }

  if (currentId !== null && traversalStatus === "unresolved") {
    traversalStatus = "depth_limit";
    blockers.push(`Die Hierarchiekette überschreitet die sichere Lesetiefe von ${maxDepth}.`);
  }

  let status: EvidenceStatus = "unresolved";
  if (traversalStatus === "complete") {
    status = input.definitionStatus === "confirmed" ? "confirmed" : "candidate";
  }

  if (input.definitionStatus !== "confirmed") {
    blockers.push("Die rekursive Parent-/Child-Definition ist nicht bestätigt.");
  }

  const note = traversalStatus === "complete"
    ? status === "confirmed"
      ? "Die beobachtete Parent-Kette endet an einer Wurzel und die rekursive Beziehung ist bestätigt."
      : "Die Parent-Kette ist vollständig beobachtet, aber die rekursive Beziehungsdefinition bleibt unbestätigt."
    : traversalStatus === "cycle_detected"
      ? "Die Hierarchie enthält einen Zyklus. Die Bridge stoppt die Traversierung fail-safe statt endlos weiterzulesen."
      : traversalStatus === "missing_parent"
        ? "Die beobachtete Hierarchiekette verweist auf einen nicht beobachteten Parent-Knoten."
        : traversalStatus === "depth_limit"
          ? "Die sichere maximale Lesetiefe wurde erreicht; die Kette bleibt unbestätigt."
          : "Die Hierarchie konnte nicht bestätigt werden.";

  return {
    relationId: input.relationId,
    entity: input.entity,
    nodeIdField: input.nodeIdField,
    parentIdField: input.parentIdField,
    status,
    traversalStatus,
    startId: input.startId || null,
    observedPath,
    cycleDetected,
    maxDepth,
    evidence: [...input.evidence],
    blockers,
    note,
  };
}

export function attachHierarchyAssessment(
  profile: ConfirmedInstanceProfile,
  assessment: HierarchyProfileEntry,
): ConfirmedInstanceProfile {
  return {
    ...profile,
    hierarchies: [
      ...profile.hierarchies.filter(({ relationId }) => relationId !== assessment.relationId),
      assessment,
    ],
  };
}

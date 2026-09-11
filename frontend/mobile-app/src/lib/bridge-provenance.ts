export type ProvenanceVersions = {
  bridgeVersion: string;
  contractVersion: string;
  mappingVersion: string;
  validationVersion: string;
};

export type ProvenanceMetadata = ProvenanceVersions & {
  appliedAt: string;
  sourceSnapshotId: string;
  evidenceRefs: string[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  releaseAuthority: "none";
  integrityClaim: "trace_identifier_not_cryptographic_proof";
};

export type ProvenanceInput = {
  source: string;
  sourceRecord: string;
  capturedAt: string;
  messageId: string;
  values: Record<string, string>;
  versions: ProvenanceVersions;
  evidenceRefs?: string[];
};

function stableSerialize(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`)
    .join("|");
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildSourceSnapshotId(input: Omit<ProvenanceInput, "versions" | "evidenceRefs">): string {
  const payload = [
    `source=${input.source}`,
    `record=${input.sourceRecord}`,
    `capturedAt=${input.capturedAt}`,
    `messageId=${input.messageId}`,
    `values=${stableSerialize(input.values)}`,
  ].join("\n");

  return `snap:${fnv1a32(payload)}`;
}

export function buildProvenanceMetadata(input: ProvenanceInput): ProvenanceMetadata {
  const evidenceRefs = [...new Set((input.evidenceRefs ?? []).filter((value) => value.trim().length > 0))].sort();

  return {
    ...input.versions,
    appliedAt: input.capturedAt,
    sourceSnapshotId: buildSourceSnapshotId(input),
    evidenceRefs,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    releaseAuthority: "none",
    integrityClaim: "trace_identifier_not_cryptographic_proof",
  };
}

import {
  evaluateRecordWithConflictTruth,
  type AdapterConflict,
  type ConflictTruthEvaluation,
} from "./bridge-conflict-truth";
import type { IngressContext, RawRecord, ResponseContext } from "./bridge-pipeline";

export type BridgeBatchItem = {
  raw: RawRecord;
  capturedAt: string;
  ingress?: Partial<IngressContext>;
  response?: Partial<ResponseContext>;
  conflicts?: AdapterConflict[];
};

export type BridgeBatchRecordResult = {
  recordId: string;
  releaseAllowed: boolean;
  blockingIssues: number;
  state: ConflictTruthEvaluation["state"]["state"];
  evaluation: ConflictTruthEvaluation;
};

export type BridgeBatchEvaluation = {
  total: number;
  released: number;
  blocked: number;
  records: BridgeBatchRecordResult[];
};

/**
 * Evaluates every record independently through the complete bridge decision
 * path. A blocked record never changes the release decision of a valid sibling.
 * Source records are cloned before evaluation so the batch runner cannot mutate
 * caller-owned Source Truth.
 */
export function evaluateBatch(items: BridgeBatchItem[]): BridgeBatchEvaluation {
  const records = items.map((item): BridgeBatchRecordResult => {
    const raw = structuredClone(item.raw);
    const conflicts = structuredClone(item.conflicts ?? []);
    const evaluation = evaluateRecordWithConflictTruth(
      raw,
      item.capturedAt,
      item.ingress ?? {},
      item.response ?? {},
      conflicts,
    );

    return {
      recordId: evaluation.raw.AUFTRAGS_NR,
      releaseAllowed: evaluation.release.releaseAllowed,
      blockingIssues: evaluation.release.blockingIssues,
      state: evaluation.state.state,
      evaluation,
    };
  });

  const released = records.filter(({ releaseAllowed }) => releaseAllowed).length;

  return {
    total: records.length,
    released,
    blocked: records.length - released,
    records,
  };
}

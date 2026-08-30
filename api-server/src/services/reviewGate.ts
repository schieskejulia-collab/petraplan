export interface ReviewRecordRef {
  id?: string | null;
  resolution_record_id?: string | null;
  reviewer_id?: string | null;
  reviewer_type?: string | null;
  authorization_level?: string | null;
  evidence_checked?: boolean | null;
  evidence_refs?: unknown;
  review_reason?: string | null;
  created_at?: string | null;
}

export interface ReviewSessionRef {
  id?: string | null;
  review_record_id?: string | null;
  reviewer_id?: string | null;
  reviewer_type?: string | null;
  reviewer_authorized?: boolean | null;
  authorization_level?: string | null;
  evidence_checked?: boolean | null;
  evidence_refs?: unknown;
  criteria_checked?: boolean | null;
  runtime_log_id?: string | null;
  validation_result_id?: string | null;
  created_at?: string | null;
}

export interface ReviewCriterionResultRef {
  id?: string | null;
  review_session_id?: string | null;
  result?: unknown;
  status?: unknown;
  passed?: unknown;
  evidence_ref?: unknown;
  evidence_refs?: unknown;
  review_criteria?: {
    criterion_key?: string | null;
    required?: boolean | null;
  } | null;
  created_at?: string | null;
}

export interface ReviewDecisionRef {
  id?: string | null;
  review_session_id?: string | null;
  reviewer_id?: string | null;
  reviewer_type?: string | null;
  reviewer_authorized?: boolean | null;
  authorization_level?: string | null;
  evidence_checked?: boolean | null;
  evidence_refs?: unknown;
  criteria_checked?: boolean | null;
  decision?: string | null;
  status?: string | null;
  reason?: string | null;
  review_reason?: string | null;
  decided_at?: string | null;
  runtime_log_id?: string | null;
  validation_result_id?: string | null;
  created_at?: string | null;
}

export interface ReviewTruth {
  session_id: string | null;
  reviewer_id: string | null;
  reviewer_type: string | null;
  reviewer_authorized: boolean | null;
  authorization_level: string | null;
  evidence_checked: boolean;
  evidence_reference_ids: string[];
  criteria_checked: boolean;
  criterion_result_ids: string[];
  decision: string | null;
  reason: string | null;
  decided_at: string | null;
  runtime_log_id: string | null;
  resolution_id: string | null;
  validation_result_id: string | null;
  complete: boolean;
  missing: string[];
}

function latestByCreatedAt<T extends { created_at?: string | null }>(items: T[]): T | null {
  if (!items.length) return null;
  return [...items].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Builds the current, machine-readable Review Truth from the existing review rows.
 *
 * Important: reviewer authorization, evidence, criteria proof and the validation
 * reference are never inferred. Missing proof keeps the review incomplete.
 */
export function deriveReviewTruth(input: {
  records: ReviewRecordRef[];
  sessions: ReviewSessionRef[];
  criteria: ReviewCriterionResultRef[];
  decisions: ReviewDecisionRef[];
}): ReviewTruth | null {
  const session = latestByCreatedAt(input.sessions);
  if (!session) return null;

  const record = session.review_record_id
    ? input.records.find((item) => item.id === session.review_record_id) ?? null
    : latestByCreatedAt(input.records);
  const criteria = input.criteria.filter((item) => item.review_session_id === session.id);
  const decision = latestByCreatedAt(
    input.decisions.filter((item) => item.review_session_id === session.id),
  );

  const reviewerId = decision?.reviewer_id ?? session.reviewer_id ?? record?.reviewer_id ?? null;
  const reviewerType = decision?.reviewer_type ?? session.reviewer_type ?? record?.reviewer_type ?? null;
  const reviewerAuthorized = decision?.reviewer_authorized ?? session.reviewer_authorized ?? null;
  const authorizationLevel = decision?.authorization_level ?? session.authorization_level ?? record?.authorization_level ?? null;

  const evidenceReferenceIds = unique([
    ...strings(record?.evidence_refs),
    ...strings(session.evidence_refs),
    ...strings(decision?.evidence_refs),
    ...criteria.flatMap((item) => [...strings(item.evidence_ref), ...strings(item.evidence_refs)]),
  ]);

  const evidenceChecked = Boolean(
    decision?.evidence_checked === true || session.evidence_checked === true || record?.evidence_checked === true,
  );

  const requiredCriteria = criteria.filter((item) => item.review_criteria?.required === true);
  const criteriaHaveIds = criteria.length > 0 && criteria.every((item) => Boolean(item.id));
  const allRequiredPresent = requiredCriteria.every((required) => Boolean(required.id));
  const criteriaChecked = Boolean(
    (decision?.criteria_checked === true || session.criteria_checked === true) &&
      criteriaHaveIds &&
      allRequiredPresent,
  );

  const criterionResultIds = criteria.map((item) => item.id).filter((id): id is string => Boolean(id));
  const finalDecision = decision?.decision ?? decision?.status ?? null;
  const reason = decision?.reason ?? decision?.review_reason ?? record?.review_reason ?? null;
  const decidedAt = decision?.decided_at ?? decision?.created_at ?? null;
  const runtimeLogId = decision?.runtime_log_id ?? session.runtime_log_id ?? null;
  const resolutionId = record?.resolution_record_id ?? null;
  const validationResultId = decision?.validation_result_id ?? session.validation_result_id ?? null;

  const missing: string[] = [];
  if (!reviewerId) missing.push('reviewer_id');
  if (!reviewerType) missing.push('reviewer_type');
  if (reviewerAuthorized !== true) missing.push('reviewer_authorized');
  if (!authorizationLevel) missing.push('authorization_level');
  if (!evidenceChecked) missing.push('evidence_checked');
  if (!evidenceReferenceIds.length) missing.push('evidence_reference_ids');
  if (!criteriaChecked) missing.push('criteria_checked');
  if (!criterionResultIds.length) missing.push('criterion_result_ids');
  if (!validationResultId) missing.push('validation_result_id');
  if (!finalDecision) missing.push('decision');
  if (!reason) missing.push('reason');
  if (!decidedAt) missing.push('decided_at');

  return {
    session_id: session.id ?? null,
    reviewer_id: reviewerId,
    reviewer_type: reviewerType,
    reviewer_authorized: reviewerAuthorized,
    authorization_level: authorizationLevel,
    evidence_checked: evidenceChecked,
    evidence_reference_ids: evidenceReferenceIds,
    criteria_checked: criteriaChecked,
    criterion_result_ids: criterionResultIds,
    decision: finalDecision,
    reason,
    decided_at: decidedAt,
    runtime_log_id: runtimeLogId,
    resolution_id: resolutionId,
    validation_result_id: validationResultId,
    complete: missing.length === 0,
    missing,
  };
}

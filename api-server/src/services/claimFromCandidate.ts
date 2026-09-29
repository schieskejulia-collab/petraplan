import { createHash, randomUUID } from 'node:crypto';

export const CLAIM_TYPES = [
  'SOURCE',
  'STRUCTURE',
  'REPRESENTATION',
  'SEMANTIC',
  'SEMANTIC_MAPPING',
  'MAPPING',
  'AGGREGATION',
  'CONTEXT',
  'BEHAVIOR',
  'VALIDATION',
  'DECISION',
  'AUTHORIZATION',
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

export type ConfirmedCandidate = {
  id: string;
  candidate_key: string;
  record_id: string;
  snapshot_id: string;
  source_address_id: string;
  source_path?: string | null;
  proposed_value?: unknown;
  conversion_kind?: string | null;
  evidence: string;
  state: string;
};

export type CandidateAddress = {
  id: string;
  address: string;
  kind?: string | null;
};

export type CandidateConfirmation = {
  id: string;
  changed_by: string;
  changed_at: string;
  reason: string;
  evidence_reference?: string | null;
};

export type ExplicitClaimDraftInput = {
  candidate: ConfirmedCandidate;
  sourceAddress: CandidateAddress;
  allowedSubjectAddresses: CandidateAddress[];
  subjectAddress: string;
  statement: string;
  claimType: ClaimType;
  createdBy: string;
  producerRole?: string | null;
  sourceSystem?: string | null;
  confirmation?: CandidateConfirmation | null;
};

export type ExplicitClaimDraft = {
  claim: Record<string, unknown>;
  evidenceLinks: Array<Record<string, unknown>>;
};

export function buildExplicitClaimDraft(input: ExplicitClaimDraftInput): ExplicitClaimDraft {
  if (input.candidate.state !== 'confirmed') {
    throw new Error('Only confirmed candidates can become the basis of an explicit claim draft.');
  }

  const statement = input.statement.trim();
  if (statement.length < 8) throw new Error('Claim statement is too short.');

  const allowedAddresses = new Set([
    input.sourceAddress.address,
    ...input.allowedSubjectAddresses.map((item) => item.address),
  ]);
  if (!allowedAddresses.has(input.subjectAddress)) {
    throw new Error('Claim subject must be one of the candidate source/impact addresses.');
  }

  const claimFamilyId = randomUUID();
  const payloadForHash = {
    candidate_id: input.candidate.id,
    snapshot_id: input.candidate.snapshot_id,
    subject_address: input.subjectAddress,
    predicate: input.candidate.candidate_key,
    object_value: input.candidate.proposed_value ?? null,
    statement,
    claim_type: input.claimType,
    scope_type: 'CASE_ONLY',
    record_id: input.candidate.record_id,
  };
  const claimPayloadHash = createHash('sha256').update(JSON.stringify(payloadForHash)).digest('hex');

  const claim = {
    claim_family_id: claimFamilyId,
    claim_version: 1,
    claim_type: input.claimType,
    subject_address: input.subjectAddress,
    predicate: input.candidate.candidate_key,
    object_value: input.candidate.proposed_value ?? null,
    statement,
    status: 'UNPROVEN',
    scope_type: 'CASE_ONLY',
    scope_payload: {
      record_id: input.candidate.record_id,
      snapshot_id: input.candidate.snapshot_id,
      candidate_id: input.candidate.id,
    },
    source_system: input.sourceSystem ?? null,
    snapshot_id: input.candidate.snapshot_id,
    record_id: input.candidate.record_id,
    field_address: input.subjectAddress,
    created_by: input.createdBy,
    producer_role: input.producerRole ?? null,
    candidate_id: input.candidate.id,
    claim_payload_hash: claimPayloadHash,
  };

  const evidenceLinks: Array<Record<string, unknown>> = [
    {
      evidence_type: 'SOURCE_ADDRESS',
      evidence_reference: input.sourceAddress.address,
      relation: 'DERIVED_FROM',
      directness: 'DIRECT',
      scope: { record_id: input.candidate.record_id, snapshot_id: input.candidate.snapshot_id },
      linked_by: input.createdBy,
      note: `Candidate source address ${input.sourceAddress.address}.`,
    },
    {
      evidence_type: 'SOURCE_SNAPSHOT',
      evidence_reference: input.candidate.snapshot_id,
      relation: 'DERIVED_FROM',
      directness: 'DIRECT',
      scope: { record_id: input.candidate.record_id },
      linked_by: input.createdBy,
      note: 'Immutable source snapshot used by the confirmed candidate.',
    },
    {
      evidence_type: 'CANDIDATE_EVIDENCE',
      evidence_reference: `conversion_candidate:${input.candidate.id}`,
      relation: 'SUPPORTS',
      directness: 'DIRECT',
      scope: { record_id: input.candidate.record_id, snapshot_id: input.candidate.snapshot_id },
      linked_by: input.createdBy,
      note: input.candidate.evidence,
    },
  ];

  if (input.confirmation) {
    evidenceLinks.push({
      evidence_type: 'HUMAN_CONFIRMATION',
      evidence_reference: `candidate_state_history:${input.confirmation.id}`,
      relation: 'SUPPORTS',
      directness: 'DIRECT',
      scope: {
        record_id: input.candidate.record_id,
        snapshot_id: input.candidate.snapshot_id,
        candidate_id: input.candidate.id,
      },
      linked_by: input.createdBy,
      note: input.confirmation.reason,
    });
  }

  return { claim, evidenceLinks };
}

export interface SemanticContractRef {
  id?: string | null;
  contract_key?: string | null;
  version?: string | null;
  source_system?: string | null;
  source_schema_version?: string | null;
  semantic_schema_version?: string | null;
  mapping_hash?: string | null;
  status?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
}

export interface SemanticContractDecision {
  valid: boolean;
  contractId: string | null;
  contractKey: string | null;
  version: string | null;
  mappingHash: string | null;
  sourceSchemaVersion: string | null;
  semanticSchemaVersion: string | null;
  reason: string;
  missing: string[];
}

const ACTIVE = new Set(['active', 'approved', 'trusted']);

/**
 * Validates that a semantic interpretation is anchored to one explicit contract version.
 * Missing version/hash/schema evidence is never inferred. This prevents silent semantic
 * drift when a legacy payload changes shape or a mapping is edited later.
 */
export function validateSemanticContract(
  contract: SemanticContractRef | null | undefined,
  options?: {
    expectedSourceSystem?: string | null;
    expectedSourceSchemaVersion?: string | null;
    at?: string | null;
  },
): SemanticContractDecision {
  const missing: string[] = [];

  if (!contract?.id) missing.push('contract_id');
  if (!contract?.contract_key) missing.push('contract_key');
  if (!contract?.version) missing.push('contract_version');
  if (!contract?.mapping_hash) missing.push('mapping_hash');
  if (!contract?.source_schema_version) missing.push('source_schema_version');
  if (!contract?.semantic_schema_version) missing.push('semantic_schema_version');

  const status = String(contract?.status ?? '').toLowerCase();
  const active = ACTIVE.has(status);
  if (!active) missing.push('active_contract_status');

  const expectedSourceSystem = options?.expectedSourceSystem ?? null;
  if (
    expectedSourceSystem &&
    contract?.source_system &&
    contract.source_system !== expectedSourceSystem
  ) {
    missing.push('source_system_match');
  }

  const expectedSourceSchemaVersion = options?.expectedSourceSchemaVersion ?? null;
  if (
    expectedSourceSchemaVersion &&
    contract?.source_schema_version !== expectedSourceSchemaVersion
  ) {
    missing.push('source_schema_version_match');
  }

  const at = options?.at ?? null;
  if (at && contract?.valid_from && at < contract.valid_from) missing.push('contract_not_yet_valid');
  if (at && contract?.valid_until && at > contract.valid_until) missing.push('contract_expired');

  const valid = missing.length === 0;

  return {
    valid,
    contractId: contract?.id ?? null,
    contractKey: contract?.contract_key ?? null,
    version: contract?.version ?? null,
    mappingHash: contract?.mapping_hash ?? null,
    sourceSchemaVersion: contract?.source_schema_version ?? null,
    semanticSchemaVersion: contract?.semantic_schema_version ?? null,
    reason: valid
      ? 'Semantic interpretation is anchored to an explicit active contract version.'
      : 'Semantic interpretation is not sufficiently anchored; silent schema or mapping drift must be blocked.',
    missing,
  };
}

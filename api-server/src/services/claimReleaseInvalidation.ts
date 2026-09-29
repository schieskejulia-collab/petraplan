import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClaimReleaseInvalidationResult {
  transitioned: boolean;
  previousStatus: string | null;
  effectiveStatus: string | null;
  certificateId: string | null;
  reason: string | null;
  warnings: string[];
}

async function one<T>(promise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const { data, error } = await promise;
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

const RELEASED_STATUSES = new Set(['trusted', 'exception']);

/**
 * A new explicit claim changes the current knowledge state of a case.
 * Historical validation/review/release rows are preserved, but a currently usable
 * release must not remain usable until the new claim has been evaluated, reviewed,
 * and explicitly released again.
 *
 * This function only persists the safety revocation. It does not validate or
 * confirm the new claim and it never creates a positive release decision.
 */
export async function invalidateReleaseAfterNewClaim(input: {
  supabase: SupabaseClient;
  recordId: string;
  claimId: string;
  actorUserId: string;
}): Promise<ClaimReleaseInvalidationResult> {
  const { supabase, recordId, claimId, actorUserId } = input;

  const certificate = await one<any>(
    supabase
      .from('release_certificates')
      .select('id, release_status, validation_result_id, certified_at')
      .eq('record_id', recordId)
      .order('certified_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  if (!certificate?.id) {
    return {
      transitioned: false,
      previousStatus: null,
      effectiveStatus: null,
      certificateId: null,
      reason: null,
      warnings: [],
    };
  }

  const latestHistory = await one<any>(
    supabase
      .from('release_status_history')
      .select('new_status, created_at')
      .eq('release_certificate_id', certificate.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  const previousStatus = String(latestHistory?.new_status ?? certificate.release_status ?? '').toLowerCase() || null;
  if (!previousStatus || !RELEASED_STATUSES.has(previousStatus)) {
    return {
      transitioned: false,
      previousStatus,
      effectiveStatus: previousStatus,
      certificateId: certificate.id,
      reason: null,
      warnings: [],
    };
  }

  const reason = `Neuer expliziter Claim ${claimId} wurde nach der geprüften Freigabe angelegt. Die bisherige Validation und das bisherige Review decken diesen Wissensstand nicht ab; Neuvalidierung, neues Review und eine neue explizite Freigabe sind erforderlich.`;

  const { error: historyError } = await supabase.from('release_status_history').insert({
    release_certificate_id: certificate.id,
    previous_status: previousStatus,
    new_status: 'revoked',
    changed_by: actorUserId,
    reason,
  });
  if (historyError) throw new Error(historyError.message);

  const warnings: string[] = [];

  const { error: logError } = await supabase.from('release_logs').insert({
    release_certificate_id: certificate.id,
    event_type: 'revoked',
    message: 'Release automatically revoked after a new explicit claim changed the current case knowledge state',
    details: {
      automatic: true,
      source: 'claim_freshness_invalidation',
      record_id: recordId,
      claim_id: claimId,
      validation_result_id: certificate.validation_result_id ?? null,
      previous_release_status: previousStatus,
      new_release_status: 'revoked',
    },
  });
  if (logError) warnings.push(`release_log: ${logError.message}`);

  const { error: auditError } = await supabase.from('bridge_decision_audit').insert({
    record_id: recordId,
    actor_user_id: actorUserId,
    action: 'revoke',
    reason,
    validation_result_id: certificate.validation_result_id ?? null,
    release_certificate_id: certificate.id,
    previous_release_status: previousStatus,
    new_release_status: 'revoked',
    details: {
      automatic: true,
      source: 'claim_freshness_invalidation',
      claim_id: claimId,
    },
  });
  if (auditError) warnings.push(`decision_audit: ${auditError.message}`);

  return {
    transitioned: true,
    previousStatus,
    effectiveStatus: 'revoked',
    certificateId: certificate.id,
    reason,
    warnings,
  };
}

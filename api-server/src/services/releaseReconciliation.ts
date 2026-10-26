import type { SupabaseClient } from '@supabase/supabase-js';
import { decideReleaseGate, selectAuthoritativeValidation } from './releaseGate.js';
import { selectLatestCertificate, selectLatestReleaseHistory } from './certificateAuthority.js';

export interface ReleaseReconciliationResult {
  transitioned: boolean;
  previousStatus: string | null;
  effectiveStatus: string | null;
  validationId: string | null;
  certificateId: string | null;
  reason: string | null;
}

async function rows<T>(promise: PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>): Promise<T[]> {
  const { data, error, count } = await promise;
  if (error) throw new Error(error.message);
  if (typeof count === 'number' && count > (data?.length ?? 0)) throw new Error('Incomplete decision-basis query result; release authority cannot be established.');
  return data ?? [];
}

/**
 * Reconciles an existing release certificate with the currently authoritative
 * validation. This function never invents a release decision: it delegates the
 * decision to releaseGate.ts and only persists a safety revocation when the gate
 * explicitly requires the trusted release to be revoked.
 *
 * Positive re-release is intentionally NOT automatic. A revoked release remains
 * revoked until a separate authorized human release flow says otherwise.
 */
export async function reconcileReleaseGate(input: {
  supabase: SupabaseClient;
  recordId: string;
  actorUserId: string;
  triggerValidationId?: string | null;
}): Promise<ReleaseReconciliationResult> {
  const { supabase, recordId, actorUserId, triggerValidationId = null } = input;

  const certificates = await rows<any>(
    supabase
      .from('release_certificates')
      .select('*', { count: 'exact' })
      .eq('record_id', recordId)
      .order('certified_at', { ascending: false }),
  );
  const selection = selectLatestCertificate(certificates);
  const certificate = selection.certificate;
  if (selection.ambiguous) {
    return { transitioned: false, previousStatus: null, effectiveStatus: 'blocked',
      validationId: triggerValidationId, certificateId: null,
      reason: 'Release certificate authority is ambiguous; no certificate was selected or changed.' };
  }

  if (!certificate) {
    return {
      transitioned: false,
      previousStatus: null,
      effectiveStatus: null,
      validationId: triggerValidationId,
      certificateId: null,
      reason: null,
    };
  }

  const history = await rows<any>(
    supabase
      .from('release_status_history')
      .select('new_status, created_at', { count: 'exact' })
      .eq('release_certificate_id', certificate.id)
      .order('created_at', { ascending: false }),
  );
  const selectedHistory = selectLatestReleaseHistory(history);
  if (selectedHistory.ambiguous) {
    return { transitioned: false, previousStatus: null, effectiveStatus: 'blocked',
      validationId: triggerValidationId, certificateId: certificate.id,
      reason: 'Release status history is ambiguous; no transition was written.' };
  }
  const latestHistory = selectedHistory.entry;
  const previousStatus = String(latestHistory?.new_status ?? certificate.release_status ?? '') || null;

  const conflicts = await rows<any>(
    supabase.from('conflicts').select('id', { count: 'exact' }).eq('record_id', recordId),
  );
  const conflictIds = conflicts.map((item) => item.id);
  const validations = conflictIds.length
    ? await rows<any>(
        supabase
          .from('validation_results')
          .select('id, status, created_at', { count: 'exact' })
          .in('conflict_id', conflictIds)
          .order('created_at'),
      )
    : [];

  const authoritative = selectAuthoritativeValidation(validations, certificate);
  if (!authoritative) {
    return {
      transitioned: false,
      previousStatus,
      effectiveStatus: 'blocked',
      validationId: triggerValidationId,
      certificateId: certificate.id,
      reason: 'The certificate validation basis is missing or ambiguous; no transition was written.',
    };
  }

  const gate = decideReleaseGate({
    latestValidationStatus: authoritative.status,
    latestValidationId: authoritative.id,
    certificateValidationId: certificate.validation_result_id,
    existingReleaseStatus: previousStatus,
    hasReleaseCertificate: true,
  });

  // Safety transitions are automatic; positive release decisions are not.
  if (!gate.shouldTransition || gate.effectiveStatus !== 'revoked' || previousStatus === 'revoked') {
    return {
      transitioned: false,
      previousStatus,
      effectiveStatus: gate.effectiveStatus,
      validationId: authoritative.id ?? null,
      certificateId: certificate.id,
      reason: gate.reason,
    };
  }

  const reason = gate.reason;

  const { error: historyError } = await supabase.from('release_status_history').insert({
    release_certificate_id: certificate.id,
    previous_status: previousStatus,
    new_status: 'revoked',
    changed_by: actorUserId,
    reason,
  });
  if (historyError) throw historyError;

  const { error: logError } = await supabase.from('release_logs').insert({
    release_certificate_id: certificate.id,
    event_type: 'revoked',
    message: 'Release automatically revoked after a later authoritative validation failed',
    details: {
      automatic: true,
      source: 'release_gate_reconciliation',
      record_id: recordId,
      validation_result_id: authoritative.id ?? null,
      trigger_validation_id: triggerValidationId,
      previous_release_status: previousStatus,
      new_release_status: 'revoked',
      gate_reason: reason,
    },
  });
  if (logError) throw logError;

  const { error: auditError } = await supabase.from('bridge_decision_audit').insert({
    record_id: recordId,
    actor_user_id: actorUserId,
    action: 'revoke',
    reason,
    validation_result_id: authoritative.id ?? null,
    release_certificate_id: certificate.id,
    previous_release_status: previousStatus,
    new_release_status: 'revoked',
    details: {
      automatic: true,
      source: 'release_gate_reconciliation',
      trigger_validation_id: triggerValidationId,
    },
  });
  if (auditError) throw auditError;

  return {
    transitioned: true,
    previousStatus,
    effectiveStatus: 'revoked',
    validationId: authoritative.id ?? null,
    certificateId: certificate.id,
    reason,
  };
}

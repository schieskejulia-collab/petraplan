import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReleaseGateDecision } from './releaseGate.js';

export async function verifyDisplayedRelease(
  supabase: SupabaseClient,
  recordId: string,
  validationId: string | null | undefined,
  gate: ReleaseGateDecision | null,
): Promise<ReleaseGateDecision | null> {
  if (gate?.effectiveStatus !== 'trusted') return gate;

  const unavailable = 'The freshness of the release validation could not be verified.';
  let reason = unavailable;
  if (validationId) {
    try {
      const { data, error } = await supabase.rpc('bridge_claims_after_validation', {
        p_record_id: recordId,
        p_validation_id: validationId,
      });
      if (!error && data === false) return gate;
      if (!error && data === true) reason = 'The validation basis is stale. Revalidation is required.';
    } catch {
      // A failed read cannot substantiate an active release.
    }
  }

  return { ...gate, effectiveStatus: 'blocked', shouldTransition: false, reason };
}

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getCaseTrace } from '../../../api-server/src/services/caseTrace.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_RULE = 'PetraPlan live bridge review';
const LIVE_STRUCTURE = 'PetraPlan live bridge decision';
const CRITERIA = ['source_truth_checked', 'translation_trace_checked', 'blockers_resolved'] as const;

type Action = 'confirm_candidate' | 'reject_candidate' | 'approve_review' | 'reject_review' | 'release' | 'revoke';

type Role = {
  user_id: string;
  role_name: string;
  active: boolean;
  can_review: boolean;
  can_release: boolean;
  can_revoke: boolean;
};

function isPassing(status: unknown) {
  return ['passed', 'pass', 'valid', 'validated', 'approved', 'success'].includes(String(status ?? '').toLowerCase());
}

function jsonHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authToken(req: any) {
  const header = String(req.headers?.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function one<T>(promise: any): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? null) as T | null;
}

async function many<T>(promise: any): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? []) as T[];
}

export default async function handler(req: any, res: any) {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const recordId = String(req.query?.recordId ?? '');
    if (!UUID_RE.test(recordId)) return res.status(400).json({ error: 'recordId must be a UUID' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseSecretKey) return res.status(500).json({ error: 'Server configuration incomplete' });

    const token = authToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return res.status(401).json({ error: 'Invalid or expired session' });
    const user = userData.user;

    const role = await one<Role>(
      supabase.from('bridge_actor_roles').select('*').eq('user_id', user.id).eq('active', true).maybeSingle(),
    );
    if (!role) return res.status(403).json({ error: 'No active Bridge decision role' });

    const trace = await getCaseTrace(supabase, recordId);
    if (!trace) return res.status(404).json({ error: 'Case not found' });

    const authoritative: any = trace.validation.authoritative;
    const review: any = trace.review.current;
    const releaseStatus = trace.release.effective_status;
    const unresolvedCandidates = await many<any>(
      supabase
        .from('conversion_candidates')
        .select('id')
        .eq('record_id', recordId)
        .eq('state', 'candidate'),
    );
    const unresolvedCandidateCount = unresolvedCandidates.length;
    const validationPassing = Boolean(authoritative?.id && isPassing(authoritative.status));
    const reviewBlockers = [
      ...(!validationPassing ? ['Die maßgebliche Validierung ist nicht bestanden.'] : []),
      ...(unresolvedCandidateCount > 0 ? [`${unresolvedCandidateCount} Kandidat${unresolvedCandidateCount === 1 ? ' ist' : 'en sind'} noch offen.`] : []),
    ];
    const access = {
      role: role.role_name,
      can_review: role.can_review,
      can_release: role.can_release,
      can_revoke: role.can_revoke,
      review_ready: Boolean(validationPassing && unresolvedCandidateCount === 0),
      review_rejection_ready: Boolean(authoritative?.id),
      unresolved_candidate_count: unresolvedCandidateCount,
      review_blockers: reviewBlockers,
      release_ready: Boolean(role.can_release && validationPassing && unresolvedCandidateCount === 0 && review?.complete && String(review?.decision ?? '').toLowerCase() === 'approved'),
      revoke_ready: Boolean(role.can_revoke && trace.release.certificates.length > 0 && releaseStatus !== 'revoked'),
    };

    if (req.method === 'GET') return res.status(200).json({ access });

    const action = String(req.body?.action ?? '') as Action;
    const reason = String(req.body?.reason ?? '').trim();
    if (!['confirm_candidate', 'reject_candidate', 'approve_review', 'reject_review', 'release', 'revoke'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported action' });
    }
    if (reason.length < 3) return res.status(400).json({ error: 'A reason is required' });

    if (action === 'confirm_candidate' || action === 'reject_candidate') {
      if (!role.can_review) return res.status(403).json({ error: 'Review permission required' });
      const candidateId = String(req.body?.candidate_id ?? '');
      if (!UUID_RE.test(candidateId)) return res.status(400).json({ error: 'candidate_id must be a UUID' });

      const candidate = await one<any>(
        supabase
          .from('conversion_candidates')
          .select('id, record_id, snapshot_id, state, source_path')
          .eq('id', candidateId)
          .eq('record_id', recordId)
          .maybeSingle(),
      );
      if (!candidate) return res.status(404).json({ error: 'Candidate does not belong to this case' });
      if (candidate.state !== 'candidate') return res.status(409).json({ error: 'Candidate has already been decided' });

      const nextState = action === 'confirm_candidate' ? 'confirmed' : 'rejected';
      const changedAt = new Date().toISOString();
      const decided = await one<any>(
        supabase
          .from('conversion_candidates')
          .update({ state: nextState })
          .eq('id', candidateId)
          .eq('record_id', recordId)
          .eq('state', 'candidate')
          .select('id')
          .maybeSingle(),
      );
      if (!decided) return res.status(409).json({ error: 'Candidate has already been decided' });

      const evidenceReference = String(req.body?.evidence_reference ?? '').trim() || candidate.source_path;
      await one<any>(
        supabase.from('candidate_state_history').insert({
          candidate_id: candidate.id,
          snapshot_id: candidate.snapshot_id,
          state: nextState,
          changed_by: user.id,
          changed_at: changedAt,
          reason,
          evidence_reference: evidenceReference,
        }).select('id').single(),
      );

      // A candidate records only a human semantic decision. It intentionally does
      // not mutate source snapshots, mapped Bridge values, validation, or release.
      return res.status(200).json({ trace: await getCaseTrace(supabase, recordId) });
    }

    if (action === 'approve_review' || action === 'reject_review') {
      if (!role.can_review) return res.status(403).json({ error: 'Review permission required' });
      if (!authoritative?.id || !authoritative?.resolution_record_id) {
        return res.status(409).json({ error: 'No authoritative validation/resolution available for review' });
      }

      if (action === 'approve_review' && !validationPassing) {
        return res.status(409).json({ error: 'Die maßgebliche Validierung ist nicht bestanden.' });
      }
      if (action === 'approve_review' && unresolvedCandidateCount > 0) {
        return res.status(409).json({ error: `${unresolvedCandidateCount} Kandidat${unresolvedCandidateCount === 1 ? ' ist' : 'en sind'} noch offen.` });
      }

      const criterionInput = req.body?.criteria ?? {};
      if (action === 'approve_review' && !CRITERIA.every((key) => criterionInput[key] === true)) {
        return res.status(409).json({ error: 'All required review criteria must be confirmed before approval' });
      }

      const rule = await one<any>(supabase.from('review_rules').select('*').eq('name', LIVE_RULE).eq('active', true).single());
      const structure = await one<any>(supabase.from('review_structures').select('*').eq('rule_id', rule?.id).eq('name', LIVE_STRUCTURE).single());
      if (!rule || !structure) return res.status(500).json({ error: 'Live review structure is not configured' });
      const criteria = await many<any>(supabase.from('review_criteria').select('*').eq('structure_id', structure.id));

      const evidenceRefs = [
        `record:${recordId}`,
        `validation:${authoritative.id}`,
        trace.source.ingestion?.id ? `ingestion:${String(trace.source.ingestion.id)}` : null,
      ].filter(Boolean) as string[];
      const now = new Date().toISOString();
      const decisionName = action === 'approve_review' ? 'approved' : 'rejected';

      const reviewRecord = await one<any>(
        supabase.from('review_records').insert({
          resolution_record_id: authoritative.resolution_record_id,
          validation_result_id: authoritative.id,
          reviewer_id: user.id,
          reviewer_type: 'human',
          review_status: decisionName,
          review_reason: reason,
          reviewed_at: now,
        }).select('*').single(),
      );

      const session = await one<any>(
        supabase.from('review_sessions').insert({
          review_record_id: reviewRecord?.id,
          rule_id: rule.id,
          structure_id: structure.id,
          status: decisionName,
          started_at: now,
          completed_at: now,
          reviewer_authorized: true,
          authorization_level: role.role_name,
          evidence_checked: true,
          evidence_refs: evidenceRefs,
          criteria_checked: true,
          validation_result_id: authoritative.id,
        }).select('*').single(),
      );

      for (const criterion of criteria) {
        const key = String(criterion.criterion_key);
        const passed = criterionInput[key] === true;
        await one<any>(supabase.from('review_criterion_results').insert({
          review_session_id: session?.id,
          criterion_id: criterion.id,
          result: { value: passed },
          passed,
          evidence: { record_id: recordId, validation_result_id: authoritative.id },
          checked_by: user.id,
        }).select('id').single());
      }

      const decision = await one<any>(
        supabase.from('review_decisions').insert({
          review_session_id: session?.id,
          decision: decisionName,
          reason,
          decided_by: user.id,
          reviewer_type: 'human',
          final: true,
          reviewer_id: user.id,
          reviewer_authorized: true,
          authorization_level: role.role_name,
          evidence_checked: true,
          evidence_refs: evidenceRefs,
          criteria_checked: true,
          decided_at: now,
          validation_result_id: authoritative.id,
        }).select('*').single(),
      );

      await supabase.from('review_status_history').insert({
        review_session_id: session?.id,
        previous_status: 'pending',
        new_status: decisionName,
        changed_by: user.id,
        reason,
      });
      await supabase.from('review_logs').insert({
        review_session_id: session?.id,
        event_type: 'authorized_mobile_decision',
        message: `Live Bridge review ${decisionName}`,
        details: { record_id: recordId, validation_result_id: authoritative.id, reviewer_role: role.role_name },
      });
      await supabase.from('bridge_decision_audit').insert({
        record_id: recordId,
        actor_user_id: user.id,
        action,
        reason,
        validation_result_id: authoritative.id,
        review_record_id: reviewRecord?.id,
        review_decision_id: decision?.id,
        previous_release_status: releaseStatus,
        new_release_status: releaseStatus,
        details: { criteria: criterionInput, evidence_refs: evidenceRefs },
      });

      return res.status(200).json({ trace: await getCaseTrace(supabase, recordId) });
    }

    if (action === 'release') {
      if (!role.can_release) return res.status(403).json({ error: 'Release permission required' });
      if (!authoritative?.id || !isPassing(authoritative.status)) return res.status(409).json({ error: 'Authoritative validation is not passing' });
      if (unresolvedCandidateCount > 0) return res.status(409).json({ error: `${unresolvedCandidateCount} Kandidat${unresolvedCandidateCount === 1 ? ' ist' : 'en sind'} noch offen.` });
      if (!review?.complete || String(review.decision ?? '').toLowerCase() !== 'approved' || review.reviewer_authorized !== true) {
        return res.status(409).json({ error: 'A complete authorized approval is required before release' });
      }

      const session = await one<any>(supabase.from('review_sessions').select('*').eq('id', review.session_id).single());
      const reviewRecord = await one<any>(supabase.from('review_records').select('*').eq('id', session?.review_record_id).single());
      const reviewDecision = await one<any>(supabase.from('review_decisions').select('*').eq('review_session_id', review.session_id).order('created_at', { ascending: false }).limit(1).single());
      if (!reviewRecord || !reviewDecision) return res.status(409).json({ error: 'Review references are incomplete' });

      const existing = trace.release.certificates.length ? trace.release.certificates[trace.release.certificates.length - 1] as any : null;
      let certificate = existing;
      if (!certificate) {
        const snapshot = {
          record_id: recordId,
          conflict_id: authoritative.conflict_id,
          resolution_record_id: authoritative.resolution_record_id,
          validation_result_id: authoritative.id,
          review_record_id: reviewRecord.id,
          review_decision_id: reviewDecision.id,
          source_hash: trace.source.ingestion?.source_hash ?? null,
          certified_at: new Date().toISOString(),
        };
        certificate = await one<any>(
          supabase.from('release_certificates').insert({
            record_id: recordId,
            conflict_id: authoritative.conflict_id,
            resolution_record_id: authoritative.resolution_record_id,
            validation_result_id: authoritative.id,
            review_record_id: reviewRecord.id,
            review_decision_id: reviewDecision.id,
            release_status: 'trusted',
            certified_by_type: 'human',
            certified_by: user.id,
            reason,
            truth_snapshot: snapshot,
            certificate_hash: jsonHash(snapshot),
          }).select('*').single(),
        );
      }

      if (releaseStatus !== 'trusted') {
        await supabase.from('release_status_history').insert({
          release_certificate_id: certificate.id,
          previous_status: releaseStatus,
          new_status: 'trusted',
          changed_by: user.id,
          reason,
        });
      }
      await supabase.from('release_logs').insert({
        release_certificate_id: certificate.id,
        event_type: 'authorized_mobile_release',
        message: 'Release confirmed in Live Bridge',
        details: { record_id: recordId, validation_result_id: authoritative.id, review_decision_id: reviewDecision.id },
      });
      if (authoritative.conflict_id) {
        await supabase.from('conflicts').update({
          resolution_status: 'resolved', resolved_by: user.id, resolved_at: new Date().toISOString(), resolution_note: reason,
        }).eq('id', authoritative.conflict_id);
      }
      await supabase.from('bridge_decision_audit').insert({
        record_id: recordId,
        actor_user_id: user.id,
        action,
        reason,
        validation_result_id: authoritative.id,
        review_record_id: reviewRecord.id,
        review_decision_id: reviewDecision.id,
        release_certificate_id: certificate.id,
        previous_release_status: releaseStatus,
        new_release_status: 'trusted',
      });
      return res.status(200).json({ trace: await getCaseTrace(supabase, recordId) });
    }

    if (!role.can_revoke) return res.status(403).json({ error: 'Revoke permission required' });
    const certificate: any = trace.release.certificates.length ? trace.release.certificates[trace.release.certificates.length - 1] : null;
    if (!certificate) return res.status(409).json({ error: 'No release certificate exists to revoke' });
    if (releaseStatus !== 'revoked') {
      await supabase.from('release_status_history').insert({
        release_certificate_id: certificate.id,
        previous_status: releaseStatus,
        new_status: 'revoked',
        changed_by: user.id,
        reason,
      });
    }
    await supabase.from('release_logs').insert({
      release_certificate_id: certificate.id,
      event_type: 'authorized_mobile_revoke',
      message: 'Release revoked in Live Bridge',
      details: { record_id: recordId },
    });
    await supabase.from('bridge_decision_audit').insert({
      record_id: recordId,
      actor_user_id: user.id,
      action,
      reason,
      validation_result_id: authoritative?.id ?? null,
      release_certificate_id: certificate.id,
      previous_release_status: releaseStatus,
      new_release_status: 'revoked',
    });
    return res.status(200).json({ trace: await getCaseTrace(supabase, recordId) });
  } catch (error) {
    console.error('PetraPlan decision API failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown decision error' });
  }
}

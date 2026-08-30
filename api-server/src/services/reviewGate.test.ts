import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveReviewTruth } from './reviewGate.js';

test('complete review requires authorization level, evidence, criteria and validation reference', () => {
  const truth = deriveReviewTruth({
    records: [{
      id: 'r1',
      resolution_record_id: 'res1',
      reviewer_id: 'u1',
      reviewer_type: 'human',
      review_reason: 'Checked source conflict.',
    }],
    sessions: [{
      id: 's1',
      review_record_id: 'r1',
      reviewer_authorized: true,
      authorization_level: 'release_reviewer',
      evidence_checked: true,
      evidence_refs: ['source:1'],
      criteria_checked: true,
      runtime_log_id: 'run1',
      validation_result_id: 'val1',
      created_at: '2026-08-30T10:00:00Z',
    }],
    criteria: [{
      id: 'c1',
      review_session_id: 's1',
      review_criteria: { criterion_key: 'source_preserved', required: true },
      created_at: '2026-08-30T10:01:00Z',
    }],
    decisions: [{
      id: 'd1',
      review_session_id: 's1',
      decision: 'approved',
      reason: 'Evidence and criteria verified.',
      decided_at: '2026-08-30T10:02:00Z',
      created_at: '2026-08-30T10:02:00Z',
    }],
  });

  assert.ok(truth);
  assert.equal(truth.complete, true);
  assert.deepEqual(truth.missing, []);
  assert.equal(truth.reviewer_authorized, true);
  assert.equal(truth.authorization_level, 'release_reviewer');
  assert.equal(truth.evidence_checked, true);
  assert.deepEqual(truth.evidence_reference_ids, ['source:1']);
  assert.equal(truth.criteria_checked, true);
  assert.deepEqual(truth.criterion_result_ids, ['c1']);
  assert.equal(truth.validation_result_id, 'val1');
  assert.equal(truth.resolution_id, 'res1');
  assert.equal(truth.runtime_log_id, 'run1');
});

test('review stays incomplete when authorization, evidence and validation are only implied', () => {
  const truth = deriveReviewTruth({
    records: [{ id: 'r1', reviewer_id: 'u1', reviewer_type: 'human', review_reason: 'Looks fine.' }],
    sessions: [{ id: 's1', review_record_id: 'r1', created_at: '2026-08-30T10:00:00Z' }],
    criteria: [{
      id: 'c1',
      review_session_id: 's1',
      review_criteria: { criterion_key: 'source_preserved', required: true },
    }],
    decisions: [{
      id: 'd1',
      review_session_id: 's1',
      decision: 'approved',
      reason: 'Looks fine.',
      decided_at: '2026-08-30T10:02:00Z',
      created_at: '2026-08-30T10:02:00Z',
    }],
  });

  assert.ok(truth);
  assert.equal(truth.complete, false);
  assert.ok(truth.missing.includes('reviewer_authorized'));
  assert.ok(truth.missing.includes('authorization_level'));
  assert.ok(truth.missing.includes('evidence_checked'));
  assert.ok(truth.missing.includes('evidence_reference_ids'));
  assert.ok(truth.missing.includes('criteria_checked'));
  assert.ok(truth.missing.includes('validation_result_id'));
});

test('only the latest review session governs current Review Truth', () => {
  const truth = deriveReviewTruth({
    records: [
      { id: 'r1', reviewer_id: 'old', reviewer_type: 'human' },
      { id: 'r2', reviewer_id: 'new', reviewer_type: 'human' },
    ],
    sessions: [
      { id: 's1', review_record_id: 'r1', created_at: '2026-08-30T09:00:00Z' },
      { id: 's2', review_record_id: 'r2', created_at: '2026-08-30T11:00:00Z' },
    ],
    criteria: [],
    decisions: [
      { id: 'd1', review_session_id: 's1', decision: 'approved', created_at: '2026-08-30T09:10:00Z' },
      { id: 'd2', review_session_id: 's2', decision: 'rejected', created_at: '2026-08-30T11:10:00Z' },
    ],
  });

  assert.ok(truth);
  assert.equal(truth.session_id, 's2');
  assert.equal(truth.reviewer_id, 'new');
  assert.equal(truth.decision, 'rejected');
});

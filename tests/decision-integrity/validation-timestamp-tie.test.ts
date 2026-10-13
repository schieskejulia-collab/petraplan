import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAuthoritativeValidation } from '../../api-server/src/services/releaseGate.js';

const passed = { id: 'pass', status: 'passed', created_at: '2026-10-13T12:00:00Z' };
const failed = { id: 'fail', status: 'failed', created_at: '2026-10-13T12:00:00Z' };

test('REGRESSION: pre-certificate conflicting validations at identical time cannot select passing by input order', () => {
  for (const validations of [[passed, failed], [failed, passed]]) {
    const result = selectAuthoritativeValidation(validations);
    assert.notEqual(result?.status, 'passed', 'A tied contradictory validation must not silently authorize release');
  }
});

test('certificate reference remains baseline for same-timestamp validations', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  assert.equal(selectAuthoritativeValidation([failed, passed], cert)?.id, 'pass');
  assert.equal(selectAuthoritativeValidation([passed, failed], cert)?.id, 'pass');
});

test('a provably later negative validation overrides the certificate baseline', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const later = { ...failed, created_at: '2026-10-13T12:00:01Z' };
  assert.equal(selectAuthoritativeValidation([passed, later], cert)?.id, 'fail');
});

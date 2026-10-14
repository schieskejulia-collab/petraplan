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

test('two later validations with equal timestamps cannot conceal a negative result', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const newerPass = { id: 'new-pass', status: 'passed', created_at: '2026-10-13T12:00:01Z' };
  const newerFail = { id: 'new-fail', status: 'failed', created_at: '2026-10-13T12:00:01Z' };
  for (const validations of [[passed, newerPass, newerFail], [newerFail, passed, newerPass]]) {
    assert.equal(selectAuthoritativeValidation(validations, cert)?.id, 'new-fail');
  }
});

test('a uniquely later passing validation is authoritative, not an older failure', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const olderFail = { id: 'old-fail', status: 'failed', created_at: '2026-10-13T11:59:59Z' };
  const newerPass = { id: 'new-pass', status: 'passed', created_at: '2026-10-13T12:00:01Z' };
  assert.equal(selectAuthoritativeValidation([olderFail, passed, newerPass], cert)?.id, 'new-pass');
});

test('same timestamp but different timezone offsets is compared as an instant', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const newerFail = { id: 'offset-fail', status: 'failed', created_at: '2026-10-13T14:00:01+02:00' };
  assert.equal(selectAuthoritativeValidation([passed, newerFail], cert)?.id, 'offset-fail');
});


test('earlier instant with a larger local clock does not override certificate', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const olderFail = { id: 'offset-older-fail', status: 'failed', created_at: '2026-10-13T13:59:59+02:00' };
  assert.equal(selectAuthoritativeValidation([passed, olderFail], cert)?.id, 'pass');
});

test('later instant with a smaller local clock overrides certificate', () => {
  const cert = { validation_result_id: 'pass', certified_at: '2026-10-13T12:00:00Z' };
  const laterFail = { id: 'offset-later-fail', status: 'failed', created_at: '2026-10-13T11:00:01-01:00' };
  assert.equal(selectAuthoritativeValidation([passed, laterFail], cert)?.id, 'offset-later-fail');
});


test('newest instant wins even when its local clock text sorts earlier', () => {
  const newerPass = { id: 'offset-newer-pass', status: 'passed', created_at: '2026-10-13T11:00:01-01:00' };
  const olderFail = { id: 'offset-older-fail', status: 'failed', created_at: '2026-10-13T13:59:59+02:00' };
  for (const entries of [[olderFail, newerPass], [newerPass, olderFail]]) {
    assert.equal(selectAuthoritativeValidation(entries)?.id, 'offset-newer-pass');
  }
});

test('same instant with different timezone offsets prefers negative validation', () => {
  const pass = { id: 'offset-pass', status: 'passed', created_at: '2026-10-13T14:00:00+02:00' };
  const fail = { id: 'offset-fail', status: 'failed', created_at: '2026-10-13T12:00:00Z' };
  for (const entries of [[pass, fail], [fail, pass]]) {
    assert.equal(selectAuthoritativeValidation(entries)?.id, 'offset-fail');
  }
});

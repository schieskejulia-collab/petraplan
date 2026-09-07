import assert from 'node:assert/strict';
import test from 'node:test';
import { processRecord } from './mappingEngine.js';

const fixedTime = '2026-09-07T11:15:00.000Z';

function run(raw: Record<string, unknown>) {
  return processRecord(raw, {
    sourceSystem: 'System_A',
    recordId: '4711',
    capturedAt: fixedTime,
  });
}

test('maps a valid record into the canonical model without mutating raw data', () => {
  const raw = {
    KNR: '4711',
    STAT: 'F',
    BETR: '1250.50',
    DATUM: '07.09.2026',
  };
  const before = JSON.stringify(raw);

  const result = run(raw);

  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(result.sourceSnapshot.raw, raw);
  assert.equal(result.sourceSnapshot.readOnly, true);
  assert.deepEqual(result.canonical, {
    customerId: '4711',
    status: 'approved',
    amount: 1250.5,
    orderDate: '2026-09-07',
  });
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.releaseAllowed, true);
  assert.deepEqual(result.validation.issues, []);
});

test('fails closed for an unknown status and does not invent a canonical value', () => {
  const result = run({
    KNR: '4711',
    STAT: 'X',
    BETR: '1250.50',
    DATUM: '07.09.2026',
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.releaseAllowed, false);
  assert.equal(result.canonical.status, undefined);

  const issue = result.validation.issues.find(
    (entry) => entry.issueType === 'UNKNOWN_VALUE',
  );

  assert.ok(issue);
  assert.equal(issue.field, 'STAT');
  assert.equal(issue.sourceValue, 'X');
  assert.equal(issue.severity, 'BLOCKING');

  const trace = result.trace.find((entry) => entry.sourceField === 'STAT');
  assert.ok(trace);
  assert.equal(trace.validation, 'FAIL');
  assert.equal(trace.canonicalValue, null);
});

test('blocks a negative amount and records the violated rule', () => {
  const result = run({
    KNR: '4711',
    STAT: 'F',
    BETR: '-4',
    DATUM: '07.09.2026',
  });

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.releaseAllowed, false);
  assert.equal(result.canonical.amount, undefined);

  const issue = result.validation.issues.find(
    (entry) => entry.issueType === 'NEGATIVE_VALUE',
  );

  assert.ok(issue);
  assert.equal(issue.rule, 'min >= 0');
  assert.equal(issue.sourceValue, '-4');
});

test('rejects a non-decimal amount and preserves a failure trace', () => {
  const result = run({
    KNR: '4711',
    STAT: 'F',
    BETR: 'ABC',
    DATUM: '07.09.2026',
  });

  const issue = result.validation.issues.find(
    (entry) => entry.field === 'BETR' && entry.issueType === 'INVALID_TYPE',
  );
  assert.ok(issue);

  const trace = result.trace.find((entry) => entry.sourceField === 'BETR');
  assert.ok(trace);
  assert.equal(trace.validation, 'FAIL');
  assert.equal(trace.canonicalValue, null);
});

test('rejects a calendar-invalid date even when the text format looks correct', () => {
  const result = run({
    KNR: '4711',
    STAT: 'F',
    BETR: '1250.50',
    DATUM: '31.02.2026',
  });

  const issue = result.validation.issues.find(
    (entry) => entry.issueType === 'INVALID_DATE',
  );

  assert.ok(issue);
  assert.equal(result.canonical.orderDate, undefined);
  assert.equal(result.validation.releaseAllowed, false);
});

test('reports multiple blocking issues in one pass', () => {
  const result = run({
    KNR: '',
    STAT: 'X',
    BETR: '-99',
    DATUM: '31.02.2026',
  });

  const issueTypes = result.validation.issues.map((issue) => issue.issueType);

  assert.ok(issueTypes.includes('MISSING_REQUIRED_VALUE'));
  assert.ok(issueTypes.includes('UNKNOWN_VALUE'));
  assert.ok(issueTypes.includes('NEGATIVE_VALUE'));
  assert.ok(issueTypes.includes('INVALID_DATE'));
  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.releaseAllowed, false);
});

test('treats an absent required field as missing', () => {
  const result = run({
    STAT: 'F',
    BETR: '1250.50',
    DATUM: '07.09.2026',
  });

  const issue = result.validation.issues.find(
    (entry) => entry.field === 'KNR' && entry.issueType === 'MISSING_REQUIRED_VALUE',
  );

  assert.ok(issue);
  assert.equal(result.canonical.customerId, undefined);
  assert.equal(result.validation.releaseAllowed, false);
});

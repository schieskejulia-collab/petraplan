import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBoolean,
  normalizeDate,
  normalizeInteger,
  normalizeNumeric,
  normalizeTimestamp,
  transformPayload,
} from './transform.js';

test('parses explicit German decimal format without losing value', () => {
  assert.equal(normalizeNumeric('1.250,50'), 1250.5);
});

test('rejects ambiguous dot-only numeric format', () => {
  assert.throws(() => normalizeNumeric('1.234'), /ambiguous_numeric_format/);
});

test('rejects decimals for INTEGER', () => {
  assert.throws(() => normalizeInteger('12,5'), /Invalid integer value/);
});

test('rejects unknown boolean markers instead of silently converting to false', () => {
  assert.throws(() => normalizeBoolean('J'), /ambiguous_boolean_value/);
});

test('validates real calendar dates', () => {
  assert.equal(normalizeDate('2026-08-27'), '2026-08-27');
  assert.throws(() => normalizeDate('2026-02-31'), /Invalid date value/);
});

test('requires timezone evidence for timestamptz', () => {
  assert.throws(
    () => normalizeTimestamp('2026-08-27 21:00:00', true),
    /ambiguous_timestamp_timezone/,
  );
  assert.equal(
    normalizeTimestamp('2026-08-27T21:00:00+02:00', true),
    '2026-08-27T19:00:00.000Z',
  );
});

test('keeps NUMC identifiers as text and preserves leading zeroes', () => {
  const result = transformPayload(
    { KDNR: '001024', BETRAG: '1.250,50' },
    { KDNR: 'customer_id', BETRAG: 'amount' },
    { KDNR: 'NUMC', BETRAG: 'DECIMAL' },
  );

  assert.deepEqual(result, {
    customer_id: '001024',
    amount: 1250.5,
  });
});

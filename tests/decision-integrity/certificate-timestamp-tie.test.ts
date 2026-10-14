import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLatestCertificate, selectLatestReleaseHistory } from '../../api-server/src/services/certificateAuthority.js';

const trusted = { id: 'cert-trusted', certified_at: '2026-10-13T12:00:00Z', release_status: 'trusted' };
const revoked = { id: 'cert-revoked', certified_at: '2026-10-13T12:00:00Z', release_status: 'revoked' };

test('certificate selection is independent of input order on timestamp tie', () => {
  for (const items of [[trusted, revoked], [revoked, trusted]]) {
    const selected = selectLatestCertificate(items);
    assert.equal(selected.ambiguous, true);
    assert.equal(selected.certificate, null);
  }
});

test('conflicting certificates at the same latest timestamp fail closed', () => {
  const selected = selectLatestCertificate([revoked, trusted]);
  assert.equal(selected.ambiguous, true);
  assert.notEqual(selected.certificate?.release_status, 'trusted');
});

test('unique newest certificate is selected regardless of input order', () => {
  const old = { ...revoked, certified_at: '2026-10-12T12:00:00Z' };
  for (const items of [[old, trusted], [trusted, old]]) {
    const selected = selectLatestCertificate(items);
    assert.equal(selected.ambiguous, false);
    assert.equal(selected.certificate?.id, trusted.id);
  }
});

test('missing timestamps cannot establish unique certificate authority', () => {
  assert.deepEqual(selectLatestCertificate([{ id: 'legacy', certified_at: null }]), { certificate: null, ambiguous: true });
});

test('release status history tie fails closed regardless of input order', () => {
  const trusted = { created_at: '2026-10-13T12:00:00Z', new_status: 'trusted' };
  const revoked = { created_at: '2026-10-13T12:00:00Z', new_status: 'revoked' };
  for (const entries of [[trusted, revoked], [revoked, trusted]]) {
    assert.deepEqual(selectLatestReleaseHistory(entries), { entry: null, ambiguous: true });
  }
});

test('unique latest status history wins over older entry', () => {
  const old = { created_at: '2026-10-12T12:00:00Z', new_status: 'trusted' };
  const newest = { created_at: '2026-10-13T12:00:00Z', new_status: 'revoked' };
  const result = selectLatestReleaseHistory([newest, old]);
  assert.equal(result.ambiguous, false);
  assert.equal(result.entry?.new_status, 'revoked');
});


test('certificates representing the same instant in different offsets are ambiguous', () => {
  const other = { ...revoked, certified_at: '2026-10-13T14:00:00+02:00' };
  assert.deepEqual(selectLatestCertificate([trusted, other]), { certificate: null, ambiguous: true });
});

test('certificate ordering uses actual instants across offsets', () => {
  const older = { ...revoked, certified_at: '2026-10-13T13:59:59+02:00' };
  assert.equal(selectLatestCertificate([older, trusted]).certificate?.id, trusted.id);
});

test('release history ties across offsets block release', () => {
  const a = { created_at: '2026-10-13T12:00:00Z', new_status: 'trusted' };
  const b = { created_at: '2026-10-13T14:00:00+02:00', new_status: 'revoked' };
  assert.equal(selectLatestReleaseHistory([a, b]).ambiguous, true);
});

test('invalid latest-only certificate timestamp is not authoritative', () => {
  assert.equal(selectLatestCertificate([{ id: 'bad', certified_at: 'not-a-date' }]).ambiguous, true);
});

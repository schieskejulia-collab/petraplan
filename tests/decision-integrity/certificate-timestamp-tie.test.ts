import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLatestCertificate } from '../../api-server/src/services/certificateAuthority.js';

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

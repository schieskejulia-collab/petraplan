import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLatestCertificate, selectLatestReleaseHistory } from '../../api-server/src/services/certificateAuthority.js';

const trusted = { id: 'cert-trusted', certified_at: '2026-10-13T12:00:00Z', release_status: 'trusted' };
const revoked = { id: 'cert-revoked', certified_at: '2026-10-13T12:00:00Z', release_status: 'revoked' };

test('a later legacy trusted event cannot conceal an earlier terminal revocation',()=>{
 const earlier={created_at:'2026-10-13T12:00:00Z',new_status:'revoked'};
 const later={created_at:'2026-10-13T12:00:01Z',new_status:'trusted'};
 for(const entries of [[earlier,later],[later,earlier]])
  assert.equal(selectLatestReleaseHistory(entries).ambiguous,true);
});

test('undated certificate or history beside a dated entry remains ambiguous', () => {
  for (const invalid of [null, 'not-a-date']) {
    assert.equal(selectLatestCertificate([trusted,{...revoked,certified_at:invalid}]).ambiguous,true);
    assert.equal(selectLatestReleaseHistory([
      {created_at:trusted.certified_at,new_status:'trusted'}, {created_at:invalid,new_status:'revoked'},
    ]).ambiguous,true);
  }
});

test('PostgreSQL microsecond ordering does not collapse distinct certificates or history', () => {
  const older={...trusted,certified_at:'2026-10-13T12:00:00.000001Z'};
  const newer={...revoked,certified_at:'2026-10-13T14:00:00.000002+02:00'};
  for(const items of [[older,newer],[newer,older]]) {
    const result=selectLatestCertificate(items);
    assert.equal(result.ambiguous,false);
    assert.equal(result.certificate?.id,newer.id);
    const history=selectLatestReleaseHistory(items.map(x=>({created_at:x.certified_at,new_status:x.release_status})));
    assert.equal(history.entry?.new_status,'revoked');
  }
});

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

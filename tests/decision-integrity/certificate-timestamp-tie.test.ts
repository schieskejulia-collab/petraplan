import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Contract regression: a timestamp tie must not silently choose a certificate.
 * These tests document the current unsafe selection behavior, without touching
 * production logic. The initial CI failure is intentional evidence of the gap.
 */
type Certificate = { id: string; certified_at: string; release_status: string };
const currentTraceSelection = (releases: Certificate[]) =>
  releases.length ? releases[releases.length - 1] : null;

test('REGRESSION: certificate selection must not depend on input order when certified_at ties', () => {
  const trusted = { id: 'cert-trusted', certified_at: '2026-10-13T12:00:00Z', release_status: 'trusted' };
  const revoked = { id: 'cert-revoked', certified_at: '2026-10-13T12:00:00Z', release_status: 'revoked' };

  const forward = currentTraceSelection([trusted, revoked]);
  const reverse = currentTraceSelection([revoked, trusted]);

  assert.equal(forward?.id, reverse?.id,
    'Same-timestamp certificates must not yield different authority depending on row order');
});

test('REGRESSION: conflicting certificates at same certified_at must fail closed', () => {
  const releases = [
    { id: 'cert-revoked', certified_at: '2026-10-13T12:00:00Z', release_status: 'revoked' },
    { id: 'cert-trusted', certified_at: '2026-10-13T12:00:00Z', release_status: 'trusted' },
  ];

  const selected = currentTraceSelection(releases);
  assert.notEqual(selected?.release_status, 'trusted',
    'Ambiguous certificates must never silently present a trusted release');
});

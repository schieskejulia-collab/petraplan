import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildExplicitClaimDraft } from './claimFromCandidate.js';

/**
 * Cross-boundary proof: execute the real EDIFACT proof bundle and pass its
 * candidate state into the REAL PetraPlan claim builder. Never fabricate
 * confirmation, DB IDs, or semantic authority.
 */
function readStinoDinoObservation() {
  const script = [
    "import { buildStinoDinoProofBundle } from './tests/edifact/stinodino-proof-bundle.mjs';",
    "const raw = \"UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48:PCE'LIN+2++4000862141411:EN'QTY+21:12:CT'UNT+7+1'\";",
    'process.stdout.write(JSON.stringify(buildStinoDinoProofBundle(raw)));',
  ].join('\n');
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

test('actual StinoDino candidate is rejected by real PetraPlan claim draft gate', () => {
  const bundle = readStinoDinoObservation();
  assert.equal(bundle.gate.candidateConfirmation, 'not_confirmed');
  assert.equal(bundle.snapshot.identityVerified, false);
  assert.equal(bundle.handoff.candidates.length, 2);
  const observation = bundle.handoff.candidates[0];
  assert.equal(observation.claimStatus, 'candidate_only');
  assert.equal(observation.parsedNumber, 48);
  assert.equal(observation.rawUnit, 'PCE');
  assert.match(observation.snapshotRef, /^sha256:[a-f0-9]{64}$/);

  // These identifiers are intentionally isolated test placeholders. They are
  // NOT persisted records, verified source addresses or a real confirmation.
  const candidate = {
    id: '11111111-1111-4111-8111-111111111111',
    candidate_key: 'EDIFACT:QTY:OBSERVATION',
    record_id: '22222222-2222-4222-8222-222222222222',
    snapshot_id: '33333333-3333-4333-8333-333333333333',
    source_address_id: '44444444-4444-4444-8444-444444444444',
    proposed_value: observation.parsedNumber,
    evidence: observation.snapshotRef,
    state: observation.claimStatus,
  };
  const address = { id: candidate.source_address_id, address: observation.address };
  assert.throws(
    () => buildExplicitClaimDraft({
      candidate, sourceAddress: address, allowedSubjectAddresses: [],
      subjectAddress: address.address,
      statement: 'EDIFACT source quantity 48 is observed, not semantically confirmed.',
      claimType: 'SEMANTIC', createdBy: 'isolated-test',
    }),
    /Only confirmed candidates/,
  );
  assert.equal(bundle.handoff.releaseAllowed, false);
  assert.equal(bundle.gate.claimDraft, 'not_created');
});

test('blocked EDIFACT input cannot cross the candidate confirmation boundary', () => {
  const script = [
    "import { buildStinoDinoProofBundle } from './tests/edifact/stinodino-proof-bundle.mjs';",
    "const raw = \"UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:ABC:PCE'UNT+5+1'\";",
    'process.stdout.write(JSON.stringify(buildStinoDinoProofBundle(raw)));',
  ].join('\n');
  const bundle = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.equal(bundle.handoff.ingestionState, 'BLOCKED');
  assert.equal(bundle.handoff.releaseAllowed, false);
  assert.equal(bundle.gate.candidateConfirmation, 'not_confirmed');
});

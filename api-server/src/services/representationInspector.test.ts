import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRepresentationEvidence } from './representationInspector.js';

test('classifies invisible whitespace and control characters without changing source data', () => {
  const rows = [
    { record_id: 'r1', field_address: 'A#MENGE', source_path: '$.MENGE', raw_representation: '12\u00a0', fidelity_status: 'preserved' },
    { record_id: 'r2', field_address: 'B#STATUS', source_path: '$.STATUS', raw_representation: 'SHIPPED\r', fidelity_status: 'preserved' },
  ];
  const before = JSON.stringify(rows);
  const result = inspectRepresentationEvidence(rows);
  assert.equal(result.findings.some((f) => f.codepoint === 'U+00A0' && f.record_count === 1), true);
  assert.equal(result.findings.some((f) => f.codepoint === 'U+000D' && f.record_count === 1), true);
  assert.equal(JSON.stringify(rows), before);
});

test('reports lossy and changed evidence as diagnostic findings', () => {
  const result = inspectRepresentationEvidence([
    { record_id: 'r1', field_address: 'A', source_path: '$.A', raw_representation: 'x', fidelity_status: 'lossy' },
    { record_id: 'r2', field_address: 'B', source_path: '$.B', raw_representation: 'y', fidelity_status: 'changed' },
  ]);
  const kinds = result.findings.map((f) => f.kind);
  assert.equal(kinds.includes('lossy'), true);
  assert.equal(kinds.includes('representation_change'), true);
});

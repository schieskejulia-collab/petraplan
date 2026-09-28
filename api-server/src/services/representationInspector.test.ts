import { describe, expect, it } from 'vitest';
import { inspectRepresentationEvidence } from './representationInspector.js';

describe('representation inspector', () => {
  it('classifies invisible whitespace and control characters without changing source data', () => {
    const rows = [
      { record_id: 'r1', field_address: 'A#MENGE', source_path: '$.MENGE', raw_representation: '12\u00a0', fidelity_status: 'preserved' },
      { record_id: 'r2', field_address: 'B#STATUS', source_path: '$.STATUS', raw_representation: 'SHIPPED\r', fidelity_status: 'preserved' },
    ];
    const before = JSON.stringify(rows);
    const result = inspectRepresentationEvidence(rows);
    expect(result.findings.some((f) => f.codepoint === 'U+00A0' && f.record_count === 1)).toBe(true);
    expect(result.findings.some((f) => f.codepoint === 'U+000D' && f.record_count === 1)).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('reports lossy and changed evidence as diagnostic findings', () => {
    const result = inspectRepresentationEvidence([
      { record_id: 'r1', field_address: 'A', source_path: '$.A', raw_representation: 'x', fidelity_status: 'lossy' },
      { record_id: 'r2', field_address: 'B', source_path: '$.B', raw_representation: 'y', fidelity_status: 'changed' },
    ]);
    expect(result.findings.map((f) => f.kind)).toEqual(expect.arrayContaining(['lossy', 'representation_change']));
  });
});

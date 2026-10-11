// StinoDino: deliberately limited, read-only EDIFACT ORDERS D96A entry.
// It preserves the raw input, segment offsets and unknown segments.
// It does NOT validate the full EDIFACT standard or grant release authority.
export function inspectEdifactOrders(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('Non-empty EDIFACT text required');
  const segments = [];
  const pattern = /(?:^|')([^']*)/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const text = match[1].trim();
    if (!text) continue;
    segments.push({ index: segments.length, raw: text, tag: text.split('+', 1)[0], elements: text.split('+').slice(1) });
  }
  const findings = [];
  const lines = [];
  let active = null;
  for (const segment of segments) {
    if (segment.tag === 'UNH') {
      const descriptor = segment.elements[1] ?? '';
      if (descriptor !== 'ORDERS:D:96A:UN') findings.push({ code: 'UNCONFIRMED_MESSAGE_TYPE', state: 'NEEDS_CONFIRMATION', segment: segment.index });
    } else if (segment.tag === 'LIN') {
      active = { sourceSegment: segment.index, lineId: segment.elements[0] ?? null, quantities: [] };
      lines.push(active);
    } else if (segment.tag === 'QTY') {
      const [qualifier, value, unit = null] = (segment.elements[0] ?? '').split(':');
      if (!active) {
        findings.push({ code: 'ORPHAN_QUANTITY', state: 'BLOCKED', segment: segment.index });
      } else {
        const valid = /^(0|[1-9]\d*)(\.\d+)?$/.test(value ?? '');
        active.quantities.push({ sourceSegment: segment.index, qualifier: qualifier ?? null, rawValue: value ?? null, unit, value: valid ? Number(value) : null });
        if (!valid || !Number.isFinite(Number(value))) findings.push({ code: 'INVALID_QUANTITY', state: 'BLOCKED', segment: segment.index });
        if (qualifier !== '21') findings.push({ code: 'UNCONFIRMED_QUANTITY_QUALIFIER', state: 'NEEDS_CONFIRMATION', segment: segment.index });
      }
    }
  }
  if (!segments.some(s => s.tag === 'UNH') || !segments.some(s => s.tag === 'UNT')) findings.push({ code: 'INCOMPLETE_ENVELOPE', state: 'BLOCKED' });
  if (!lines.length) findings.push({ code: 'NO_ORDER_LINES', state: 'NEEDS_CONFIRMATION' });
  // The presence of line quantities is never evidence of an approved order total.
  findings.push({ code: 'ORDER_TOTAL_RULE_NOT_CONFIRMED', state: 'NEEDS_CONFIRMATION' });
  return {
    rawSource: raw,
    sourcePolicy: 'preserve',
    mutationPolicy: 'read_only',
    releaseAllowed: false,
    state: findings.some(f => f.state === 'BLOCKED') ? 'BLOCKED' : 'NEEDS_CONFIRMATION',
    segments, lines, findings,
    scope: 'synthetic-fixture; not a complete EDIFACT parser; no semantic release'
  };
}

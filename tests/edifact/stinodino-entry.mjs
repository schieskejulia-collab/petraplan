// StinoDino: limited, read-only ORDERS D96A fixture inspector.
// This is NOT a full EDIFACT validator or a production ingress.
function splitEscaped(input, delimiter, release = '?') {
  const parts = [''];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === release && i + 1 < input.length) {
      // Retain the escape sequence until the relevant delimiter has been parsed.
      parts[parts.length - 1] += c + input[++i];
    } else if (c === delimiter) {
      parts.push('');
    } else {
      parts[parts.length - 1] += c;
    }
  }
  return parts;
}
export function inspectEdifactOrders(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new TypeError('Non-empty EDIFACT text required');
  const findings = [];
  // UNA customization is not supported; fail closed rather than silently misparse.
  if (raw.trimStart().startsWith('UNA')) {
    return { rawSource: raw, sourcePolicy: 'preserve', mutationPolicy: 'read_only',
      releaseAllowed: false, state: 'BLOCKED', segments: [], lines: [],
      findings: [{ code: 'UNSUPPORTED_UNA', state: 'BLOCKED' }],
      scope: 'synthetic-fixture; limited EDIFACT inspector' };
  }
  const pieces = splitEscaped(raw, "'");
  const segments = pieces.filter(s => s.trim()).map((part, index) => {
    const text = part.trim();
    const fields = splitEscaped(text, '+');
    return { index, raw: text, tag: fields[0], elements: fields.slice(1) };
  });
  const lines = [];
  let active = null;
  const recognized = new Set(['UNH', 'BGM', 'LIN', 'QTY', 'UNT']);
  for (const segment of segments) {
    if (!recognized.has(segment.tag)) findings.push({ code: 'UNKNOWN_SEGMENT', state: 'NEEDS_CONFIRMATION', segment: segment.index, tag: segment.tag });
    if (segment.tag === 'UNH' && segment.elements[1] !== 'ORDERS:D:96A:UN')
      findings.push({ code: 'UNCONFIRMED_MESSAGE_TYPE', state: 'NEEDS_CONFIRMATION', segment: segment.index });
    if (segment.tag === 'LIN') {
      active = { sourceSegment: segment.index, lineId: segment.elements[0] ?? null, quantities: [] };
      lines.push(active);
    }
    if (segment.tag === 'QTY') {
      const [qualifier, rawValue, unit = null] = splitEscaped(segment.elements[0] ?? '', ':');
      if (!active) {
        findings.push({ code: 'ORPHAN_QUANTITY', state: 'BLOCKED', segment: segment.index });
      } else {
        const valid = /^(0|[1-9]\\d*)(\\.\\d+)?$/.test(rawValue ?? '') && Number.isFinite(Number(rawValue));
        active.quantities.push({ sourceSegment: segment.index, qualifier, rawValue: rawValue ?? null, unit, value: valid ? Number(rawValue) : null });
        if (!valid) findings.push({ code: 'INVALID_QUANTITY', state: 'BLOCKED', segment: segment.index });
        if (qualifier !== '21') findings.push({ code: 'UNCONFIRMED_QUANTITY_QUALIFIER', state: 'NEEDS_CONFIRMATION', segment: segment.index });
      }
    }
  }
  const headers = segments.filter(s => s.tag === 'UNH');
  const trailers = segments.filter(s => s.tag === 'UNT');
  if (headers.length !== 1 || trailers.length !== 1 || segments[0]?.tag !== 'UNH' || segments.at(-1)?.tag !== 'UNT')
    findings.push({ code: 'INCOMPLETE_ENVELOPE', state: 'BLOCKED' });
  if (headers.length === 1 && trailers.length === 1) {
    const expected = Number(trailers[0].elements[0]);
    if (!Number.isSafeInteger(expected) || expected !== segments.length || trailers[0].elements[1] !== headers[0].elements[0])
      findings.push({ code: 'UNT_MISMATCH', state: 'BLOCKED' });
  }
  if (!lines.length) findings.push({ code: 'NO_ORDER_LINES', state: 'NEEDS_CONFIRMATION' });
  findings.push({ code: 'ORDER_TOTAL_RULE_NOT_CONFIRMED', state: 'NEEDS_CONFIRMATION' });
  return { rawSource: raw, sourcePolicy: 'preserve', mutationPolicy: 'read_only',
    releaseAllowed: false, state: findings.some(f => f.state === 'BLOCKED') ? 'BLOCKED' : 'NEEDS_CONFIRMATION',
    segments, lines, findings, scope: 'synthetic-fixture; limited EDIFACT inspector; no semantic release' };
}

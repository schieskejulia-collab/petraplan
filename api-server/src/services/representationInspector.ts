export type RepresentationIssueKind =
  | 'whitespace'
  | 'control_character'
  | 'encoding'
  | 'representation_change'
  | 'lossy'
  | 'unknown';

export interface RepresentationFinding {
  kind: RepresentationIssueKind;
  codepoint?: string;
  label: string;
  count: number;
  record_count: number;
  examples: Array<{ record_id: string; field_address: string; source_path: string }>;
}

const CONTROL_NAMES: Record<number, string> = {
  0x00: 'NUL', 0x09: 'HT / Tab', 0x0a: 'LF / Newline', 0x0b: 'VT',
  0x0c: 'FF / Form Feed', 0x0d: 'CR / Carriage Return', 0x1b: 'ESC',
};

const WHITESPACE_NAMES: Record<number, string> = {
  0x00a0: 'NBSP / geschütztes Leerzeichen',
  0x1680: 'Ogham Space Mark',
  0x180e: 'Mongolian Vowel Separator',
  0x2000: 'En Quad', 0x2001: 'Em Quad', 0x2002: 'En Space', 0x2003: 'Em Space',
  0x2004: 'Three-per-em Space', 0x2005: 'Four-per-em Space', 0x2006: 'Six-per-em Space',
  0x2007: 'Figure Space', 0x2008: 'Punctuation Space', 0x2009: 'Thin Space',
  0x200a: 'Hair Space', 0x200b: 'Zero Width Space', 0x2028: 'Line Separator',
  0x2029: 'Paragraph Separator', 0x202f: 'Narrow No-break Space',
  0x205f: 'Medium Mathematical Space', 0x3000: 'Ideographic Space', 0xfeff: 'BOM / Zero Width No-break Space',
};

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((item) => strings(item, out));
  return out;
}

function cp(n: number) { return `U+${n.toString(16).toUpperCase().padStart(4, '0')}`; }

export function inspectRepresentationEvidence(rows: any[]) {
  const buckets = new Map<string, { kind: RepresentationIssueKind; codepoint?: string; label: string; rows: any[] }>();
  const add = (key: string, kind: RepresentationIssueKind, label: string, row: any, codepoint?: string) => {
    const current = buckets.get(key) ?? { kind, codepoint, label, rows: [] };
    current.rows.push(row);
    buckets.set(key, current);
  };

  for (const row of rows) {
    for (const text of strings(row.raw_representation)) {
      for (const char of text) {
        const n = char.codePointAt(0)!;
        if (WHITESPACE_NAMES[n]) add(`ws:${n}`, 'whitespace', WHITESPACE_NAMES[n], row, cp(n));
        else if ((n >= 0 && n <= 0x1f) || n === 0x7f) add(`ctrl:${n}`, 'control_character', CONTROL_NAMES[n] ?? 'Steuerzeichen', row, cp(n));
        else if (char === '\ufffd') add('encoding:replacement', 'encoding', 'Unicode Replacement Character', row, cp(n));
      }
    }
    const fidelity = String(row.fidelity_status ?? 'unknown');
    if (fidelity === 'lossy') add('fidelity:lossy', 'lossy', 'Representation ist verlustbehaftet', row);
    else if (fidelity === 'changed') add('fidelity:changed', 'representation_change', 'Bridge-/Display-Repräsentation weicht von Raw ab', row);
  }

  const findings: RepresentationFinding[] = [...buckets.values()].map((bucket) => {
    const uniqueRecords = new Set(bucket.rows.map((row) => String(row.record_id)));
    return {
      kind: bucket.kind,
      codepoint: bucket.codepoint,
      label: bucket.label,
      count: bucket.rows.length,
      record_count: uniqueRecords.size,
      examples: bucket.rows.slice(0, 5).map((row) => ({
        record_id: String(row.record_id),
        field_address: String(row.field_address ?? ''),
        source_path: String(row.source_path ?? ''),
      })),
    };
  }).sort((a, b) => b.record_count - a.record_count || b.count - a.count);

  return {
    inspected_evidence_rows: rows.length,
    inspected_records: new Set(rows.map((row) => String(row.record_id))).size,
    affected_records: new Set(findings.flatMap((finding) => finding.examples.map((example) => example.record_id))).size,
    findings,
    note: 'Diagnose בלבד: Findings verändern weder Source Truth noch Candidate-, Validation-, Review- oder Release-Zustand.',
  };
}

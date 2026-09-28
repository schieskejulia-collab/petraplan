import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const proofDir = path.join(repo, 'docs/evidence/external-northwind-mass-proof');
const zipPath = path.join(proofDir, 'external-northwind-mass-proof-v4.zip');

if (!fs.existsSync(zipPath)) throw new Error(`Pinned proof archive missing: ${zipPath}`);

const bytes = fs.readFileSync(zipPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const expectedSha = 'ae73b740f7c3cda1ea410b3484dec7bf3121cbf5be604e95f9f7d767f97aabaf';
if (sha256 !== expectedSha) throw new Error(`Proof archive hash mismatch: ${sha256}`);

// Extract to a temporary directory using the runner's unzip command. The archive is read-only input.
const tmp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'northwind-representation-'));
const { execFileSync } = await import('node:child_process');
execFileSync('unzip', ['-q', zipPath, '-d', tmp]);

const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full); else files.push(full);
  }
}
walk(tmp);

const textFiles = files.filter((f) => /\.(jsonl|json|csv|md|txt)$/i.test(f));
const findings = new Map();
const affectedRecords = new Set();
let scannedStrings = 0;
let scannedFiles = 0;

const names = new Map([
  [0x00a0, 'NBSP / geschütztes Leerzeichen'], [0x200b, 'Zero Width Space'],
  [0x202f, 'Narrow No-break Space'], [0xfeff, 'BOM / Zero Width No-break Space'],
  [0x0009, 'HT / Tab'], [0x000a, 'LF / Newline'], [0x000d, 'CR / Carriage Return'],
]);

function add(code, file, recordId = null) {
  const key = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  const cur = findings.get(key) || { codepoint: key, label: names.get(code) || 'Steuer-/Whitespace-Zeichen', occurrences: 0, records: new Set(), examples: [] };
  cur.occurrences++;
  if (recordId) { cur.records.add(recordId); affectedRecords.add(recordId); }
  if (cur.examples.length < 5) cur.examples.push({ file: path.relative(tmp, file), record_id: recordId });
  findings.set(key, cur);
}

function inspectString(s, file, recordId) {
  scannedStrings++;
  for (const ch of s) {
    const n = ch.codePointAt(0);
    if (names.has(n) || ((n >= 0 && n <= 0x1f) && ![0x0a,0x0d,0x09].includes(n)) || n === 0x7f || ch === '\ufffd') add(n, file, recordId);
  }
}

function inspectValue(v, file, recordId) {
  if (typeof v === 'string') inspectString(v, file, recordId);
  else if (Array.isArray(v)) v.forEach((x) => inspectValue(x, file, recordId));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => inspectValue(x, file, recordId));
}

for (const file of textFiles) {
  scannedFiles++;
  const ext = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, 'utf8');
  if (ext === '.jsonl') {
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try { const obj = JSON.parse(line); const id = String(obj.recordId ?? obj.record_id ?? obj.id ?? ''); inspectValue(obj, file, id || null); } catch { inspectString(line, file, null); }
    }
  } else if (ext === '.json') {
    try { const obj = JSON.parse(text); inspectValue(obj, file, null); } catch { inspectString(text, file, null); }
  } else {
    // CSV/MD/TXT are inspected as representation text; line endings themselves are not counted as source-field findings.
    for (const line of text.split(/\r?\n/)) inspectString(line, file, null);
  }
}

const result = {
  source: 'external-northwind-mass-proof-v4.zip',
  source_sha256: sha256,
  mode: 'READ_ONLY_DIAGNOSTIC',
  scanned_files: scannedFiles,
  scanned_strings: scannedStrings,
  affected_records_with_identifiable_ids: affectedRecords.size,
  findings: [...findings.values()].map((f) => ({ ...f, record_count: f.records.size, records: undefined })).sort((a,b) => b.record_count - a.record_count || b.occurrences - a.occurrences),
  guarantees: ['source archive unchanged', 'no candidate mutation', 'no validation mutation', 'no review mutation', 'no release mutation'],
};

const outDir = path.join(repo, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'northwind-representation-inspector.json'), JSON.stringify(result, null, 2));
const md = ['# Northwind Representation Inspector', '', `- Source SHA-256: \`${sha256}\``, `- Mode: **${result.mode}**`, `- Scanned files: ${scannedFiles}`, `- Affected records with identifiable IDs: ${affectedRecords.size}`, '', '| Finding | Records | Occurrences |', '|---|---:|---:|', ...result.findings.map((f) => `| ${f.codepoint} ${f.label} | ${f.record_count} | ${f.occurrences} |`), '', '> Diagnostic only. No source, candidate, validation, review or release state was changed.', ''].join('\n');
fs.writeFileSync(path.join(outDir, 'northwind-representation-inspector.md'), md);
console.log(JSON.stringify(result, null, 2));

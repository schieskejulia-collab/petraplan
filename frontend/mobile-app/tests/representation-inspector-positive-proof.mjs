import assert from 'node:assert/strict';
import { TextDecoder } from 'node:util';

// Executable specification for the generic ingress representation layer.
// Observation != finding != effect. This test never normalizes or mutates source bytes.

const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function physicalLines(bytes) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d) {
      const end = i;
      if (bytes[i + 1] === 0x0a) i++;
      lines.push(bytes.slice(start, end));
      start = i + 1;
    } else if (bytes[i] === 0x0a) {
      lines.push(bytes.slice(start, i));
      start = i + 1;
    }
  }
  lines.push(bytes.slice(start));
  return lines;
}

function inspectBytes(bytes) {
  const findings = [];
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    findings.push({ type: 'BOM_UTF8', byte_offset: 0, bytes: 'EF BB BF', effect: 'NONE' });
  }
  try {
    return { findings, text: decoder.decode(bytes) };
  } catch (error) {
    // TextDecoder does not expose a portable byte offset, so locate the first failing prefix
    // without replacing bytes. The source remains untouched.
    let offset = null;
    for (let end = 1; end <= bytes.length; end++) {
      try { decoder.decode(bytes.slice(0, end)); } catch { offset = end - 1; break; }
    }
    findings.push({ type: 'INVALID_UTF8', byte_offset: offset, effect: 'NONE' });
    return { findings, text: null };
  }
}

function inspectCodepoints(text) {
  const explicit = new Map([
    [0x0000, 'NUL'], [0x001a, 'SUB'], [0x00a0, 'NBSP'], [0x00ad, 'SOFT_HYPHEN'],
    [0x0085, 'NEL'], [0x200b, 'ZWSP'], [0x2028, 'LSEP'], [0x2029, 'PSEP'],
    [0x202e, 'BIDI_RLO'], [0x202f, 'NARROW_NBSP'], [0xfeff, 'FEFF'], [0xfffd, 'REPLACEMENT_CHARACTER'],
  ]);
  const findings = [];
  let codepointIndex = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (explicit.has(cp)) findings.push({ type: explicit.get(cp), codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, codepoint_index: codepointIndex, effect: 'NONE' });
    codepointIndex++;
  }
  return findings;
}

function normalizationFinding(a, b, form) {
  const normalizedEqual = a.normalize(form) === b.normalize(form);
  return {
    activity: 'unicode_normalization_compare',
    normalization_form: form,
    runtime: `node ${process.version}`,
    unicode_version: process.versions.unicode ?? 'unknown',
    raw_equal: a === b,
    normalized_equal: normalizedEqual,
    effect: 'NONE',
    identity_claim: 'NONE',
    reference_claim: 'NONE',
  };
}

// Byte-level BOM must be observable before decoding.
const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8.encode('id,name\r\n1,Münster')]);
const bomResult = inspectBytes(bom);
assert.equal(bomResult.findings[0]?.type, 'BOM_UTF8');
assert.equal(bomResult.findings[0]?.byte_offset, 0);
assert.ok(bomResult.text?.startsWith('\ufeff'), 'Decoder must not silently strip BOM');

// Strict decode: invalid bytes are findings, never replacement characters manufactured by us.
const invalid = new Uint8Array([0x61, 0x2c, 0xc3, 0x28]);
const invalidResult = inspectBytes(invalid);
assert.equal(invalidResult.text, null);
assert.ok(invalidResult.findings.some((f) => f.type === 'INVALID_UTF8'));

// Positive codepoint probe.
const poison = `A\u0000B\u001aC\u00a0D\u00adE\u0085F\u200bG\u2028H\u2029I\u202eJ\u202fK\ufffdL`;
const cpFindings = inspectCodepoints(poison);
for (const expected of ['NUL','SUB','NBSP','SOFT_HYPHEN','NEL','ZWSP','LSEP','PSEP','BIDI_RLO','NARROW_NBSP','REPLACEMENT_CHARACTER']) {
  assert.ok(cpFindings.some((f) => f.type === expected), `Missing positive finding ${expected}`);
}

// Physical lines are ONLY LF, CRLF or CR. Unicode separators/control characters do not create physical lines.
const threePhysical = utf8.encode(`one\v\f\u001c\u001d\u001e\u0085\u2028\u2029\ntwo\r\nthree`);
assert.equal(physicalLines(threePhysical).length, 3);

// NFC/NFD: visibly equivalent, raw-distinct. Finding is allowed; identity/reference is not.
const nfc = 'Münster';
const nfd = 'Mu\u0308nster';
assert.equal(nfc === nfd, false);
const canonical = normalizationFinding(nfc, nfd, 'NFC');
assert.equal(canonical.normalized_equal, true);
assert.equal(canonical.identity_claim, 'NONE');
assert.equal(canonical.reference_claim, 'NONE');

// Compatibility normalization is NOT canonical equivalence: superscript two and ASCII two
// must not be reported as NFC-equivalent even though NFKC produces equal output.
const squared = '²';
const two = '2';
const nfcNegative = normalizationFinding(squared, two, 'NFC');
const nfkcFinding = normalizationFinding(squared, two, 'NFKC');
assert.equal(nfcNegative.normalized_equal, false);
assert.equal(nfkcFinding.normalized_equal, true);
assert.equal(nfkcFinding.identity_claim, 'NONE');
assert.equal(nfkcFinding.reference_claim, 'NONE');

// Same representation may be grouped/countable as a finding, but proves neither identity nor reference.
const observations = [
  { address: 'record:1/field:code', value: 'DE' },
  { address: 'record:2/field:code', value: 'DE' },
];
assert.equal(new Set(observations.map((o) => o.value)).size, 1);
assert.notEqual(observations[0].address, observations[1].address);

console.log(JSON.stringify({
  proof: 'representation-inspector-positive-negative-v1',
  invariant: 'representation != identity or semantics',
  bom: bomResult.findings,
  strict_decode: invalidResult.findings,
  codepoint_positive_findings: cpFindings,
  physical_line_count: physicalLines(threePhysical).length,
  nfc_nfd: canonical,
  compatibility_negative: { nfc: nfcNegative, nfkc: nfkcFinding },
  guarantees: ['source bytes unchanged', 'no normalization applied to source', 'no identity claim', 'no reference claim', 'no effect'],
}, null, 2));

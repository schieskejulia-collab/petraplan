import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('./stinodino-inspect.mjs', import.meta.url).pathname;
const fixture = new URL('./fixtures/orders-d96a-synthetic.edi', import.meta.url).pathname;

test('CLI writes inspectable JSON without modifying input and cannot overwrite output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stinodino-cli-'));
  const source = join(dir, 'source.edi');
  const report = join(dir, 'report.json');
  const raw = await readFile(fixture, 'utf8');
  await writeFile(source, raw);
  const first = spawnSync(process.execPath, [cli, source, report], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const parsed = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(parsed.snapshot.identityVerified, false);
  assert.equal(parsed.gate.releaseAllowed, false);
  assert.equal(parsed.gate.claimDraft, 'not_created');
  assert.equal(parsed.handoff.source.raw, raw);
  assert.equal(await readFile(source, 'utf8'), raw);
  const reportBefore = await readFile(report, 'utf8');
  const second = spawnSync(process.execPath, [cli, source, report], { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.equal(await readFile(report, 'utf8'), reportBefore);
  assert.deepEqual((await readdir(dir)).sort(), ['report.json', 'source.edi']);
});

test('CLI fails closed for missing input and same input/output path', () => {
  const noArgs = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(noArgs.status, 2);
  const same = spawnSync(process.execPath, [cli, fixture, fixture], { encoding: 'utf8' });
  assert.equal(same.status, 2);
});

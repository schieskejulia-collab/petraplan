#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { buildStinoDinoProofBundle } from './stinodino-proof-bundle.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) {
  console.error('Usage: node tests/edifact/stinodino-inspect.mjs <input.edi> <output.json>');
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(input, 'utf8');
    const bundle = buildStinoDinoProofBundle(raw);
    await writeFile(output, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx' });
    console.log(`Saved read-only proof: ${output} | ${bundle.handoff.ingestionState} | release=false`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

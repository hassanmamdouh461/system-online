#!/usr/bin/env node
/**
 * Worker test runner.
 *
 * REPLACES a hand-maintained `&&` chain in package.json, which had two failure
 * modes that hid real breakage:
 *
 *   1. `&&` short-circuits. The FIRST failing file aborted the run, so every file
 *      after it never executed and its result was silently unknown. During the
 *      audit one stale assertion in csrf.test was enough to skip ten other files —
 *      including upsert-freshness.test.mts, the guard for the money-losing sync bug.
 *      A green-to-red flip in any early file blinded the rest of the suite.
 *
 *   2. The list was written out by hand, so it drifted from the directory.
 *      rate-limit-fallback.test.mts and snapshot-write-sanitize.test.mts existed on
 *      disk but were never in the chain — they had never run in CI at all.
 *
 * This runner discovers every test/*.test.mts, runs them ALL regardless of
 * failures, prints a summary, and exits non-zero if any failed. Adding a test file
 * now enrolls it automatically.
 *
 *   node run-tests.mjs            # run everything
 *   node run-tests.mjs csrf       # run files whose name contains "csrf"
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const testDir = resolve(here, 'test');
const filter = process.argv[2];

const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mts'))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

if (files.length === 0) {
  console.error(filter ? `No test files match "${filter}"` : 'No test files found');
  process.exit(1);
}

const failed = [];
const passed = [];

for (const file of files) {
  const rel = join('test', file);
  process.stdout.write(`\n─── ${rel} ${'─'.repeat(Math.max(0, 60 - rel.length))}\n`);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(testDir, file)],
    { stdio: 'inherit', cwd: here }
  );
  if (result.status === 0) passed.push(file);
  else failed.push({ file, status: result.status, signal: result.signal });
}

console.log(`\n${'═'.repeat(64)}`);
console.log(`passed: ${passed.length}/${files.length}`);
if (failed.length > 0) {
  console.log(`failed: ${failed.length}`);
  for (const f of failed) {
    console.log(`  ✗ test/${f.file}${f.signal ? ` (signal ${f.signal})` : ` (exit ${f.status})`}`);
  }
  process.exit(1);
}
console.log('all worker tests passed');

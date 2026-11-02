import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { runLoggedProcess } from '../src/arbiter.js';

test('logged process captures streams, lines, redactions, input, timeout, and launch errors', async () => {
  const dir = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-log-'));
  const lines = [],
    errors = [];
  const base = {
    logDirectory: dir,

    sessionId: 's',

    issue: 1,

    role: 'worker',

    round: 1,

    command: process.execPath,

    args: ['-e', "process.stdout.write('hello SECRET\\nlast'); process.stderr.write('oops')"],

    timeoutMs: 5000,

    redactions: ['SECRET'],

    onStdoutLine: (line) => lines.push(line),

    onStderr: (text) => errors.push(text),
  };
  const result = await runLoggedProcess({ ...base, env: { SLOOP_TEST: '1' } });

  assert.equal(result.code, 0);
  assert.deepEqual(lines, ['hello SECRET', 'last']);
  assert.deepEqual(errors, ['oops']);
  assert.match((await import('node:fs')).readFileSync(result.logFile, 'utf8'), /\[REDACTED\]/);
  const input = await runLoggedProcess({
    ...base,

    args: ['-e', "process.stdin.on('data', d => process.stdout.write(d))"],

    input: 'input',

    onStdoutLine: undefined,
  });
  assert.equal(input.stdout, 'input');
  const newline = await runLoggedProcess({
    ...base,

    redactions: [null],

    args: ['-e', "process.stdout.write('line\\n')"],
  });
  assert.equal(newline.code, 0);
  const originalSplit = String.prototype.split;
  String.prototype.split = function (separator, limit) {
    if (separator instanceof RegExp && String(this).includes('force-empty-split')) return [];
    return originalSplit.call(this, separator, limit);
  };
  try {
    await runLoggedProcess({ ...base, args: ['-e', "process.stdout.write('force-empty-split')"] });
  } finally {
    String.prototype.split = originalSplit;
  }
  const originalReduce = Array.prototype.reduce;
  Array.prototype.reduce = function () {
    return undefined;
  };
  try {
    await runLoggedProcess({ ...base, args: ['-e', "process.stdout.write('reduce-fallback')"] });
  } finally {
    Array.prototype.reduce = originalReduce;
  }
  const timed = await runLoggedProcess({
    ...base,

    args: ['-e', 'setTimeout(() => {}, 1000)'],

    timeoutMs: 10,
  });
  assert.equal(timed.timedOut, true);
  await assert.rejects(runLoggedProcess({ ...base, command: 'definitely-not-a-real-command-xyz' }));
});

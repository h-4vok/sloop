import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { runLoggedProcess } from '../src/arbiter.js';

function createProcessOptions() {
  return {
    logDirectory: createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-log-')),
    sessionId: 's',
    issue: 1,
    role: 'worker',
    round: 1,
    command: process.execPath,
    args: [],
    timeoutMs: 5000,
  };
}

test('logged process captures streams, lines, and redacted output', async () => {
  const lines = [];
  const errors = [];
  const options = {
    ...createProcessOptions(),
    args: ['-e', "process.stdout.write('hello SECRET\\nlast'); process.stderr.write('oops')"],
    redactions: ['SECRET'],
    onStdoutLine: (line) => lines.push(line),
    onStderr: (text) => errors.push(text),
  };

  const result = await runLoggedProcess({ ...options, env: { SLOOP_TEST: '1' } });

  assert.equal(result.code, 0);
  assert.deepEqual(lines, ['hello SECRET', 'last']);
  assert.deepEqual(errors, ['oops']);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(result.logFile, 'utf8'), /\[REDACTED\]/);
});

test('logged process forwards input to the child process', async () => {
  const options = {
    ...createProcessOptions(),
    args: ['-e', "process.stdin.on('data', (data) => process.stdout.write(data))"],
    input: 'input',
  };

  const result = await runLoggedProcess(options);

  assert.equal(result.stdout, 'input');
});

test('logged process completes when output includes a trailing newline', async () => {
  const options = {
    ...createProcessOptions(),
    args: ['-e', "process.stdout.write('line\\n')"],
  };

  const result = await runLoggedProcess(options);

  assert.equal(result.code, 0);
});

test('logged process handles empty chunk splitting and reduction fallback', async () => {
  const options = createProcessOptions();
  const originalSplit = String.prototype.split;
  const originalReduce = Array.prototype.reduce;

  try {
    String.prototype.split = function (separator, limit) {
      if (separator instanceof RegExp && String(this).includes('force-empty-split')) return [];
      return originalSplit.call(this, separator, limit);
    };
    await runLoggedProcess({
      ...options,
      args: ['-e', "process.stdout.write('force-empty-split')"],
    });

    Array.prototype.reduce = function () {
      return undefined;
    };
    await runLoggedProcess({ ...options, args: ['-e', "process.stdout.write('reduce-fallback')"] });
  } finally {
    String.prototype.split = originalSplit;
    Array.prototype.reduce = originalReduce;
  }
});

test('logged process marks a child that exceeds its timeout', async () => {
  const options = {
    ...createProcessOptions(),
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    timeoutMs: 10,
  };

  const result = await runLoggedProcess(options);

  assert.equal(result.timedOut, true);
});

test('logged process rejects when the executable cannot launch', async () => {
  const options = {
    ...createProcessOptions(),
    command: 'definitely-not-a-real-command-xyz',
  };

  await assert.rejects(runLoggedProcess(options));
});

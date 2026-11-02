import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'vitest';
import { codexCliInvocation } from '../../src/codex-cli.js';

test(
  'Windows bridge preserves empty and special arguments at the global CLI process boundary',
  { skip: process.platform !== 'win32', timeout: 15_000 },
  async (t) => {
    const fixtureDir = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-global-codex-'));
    t.onTestFinished(() => rm(fixtureDir, { recursive: true, force: true }));
    await copyFile(process.execPath, join(fixtureDir, 'codex.exe'));

    const expectedArgs = [
      '',
      'prompt with spaces',
      '100% ready',
      '%PATH%',
      'a&b',
      'x^y',
      'pipe|x',
      'bang!',
      '$(whoami)',
      '2026-10-23T15:30:00Z',
      'snowman ☃',
    ];
    const childScript = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
    const cliArgs = ['-e', childScript, ...expectedArgs];
    const invocation = codexCliInvocation(cliArgs);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: fixtureDir,

        env: {
          ...process.env,

          PATH: `${fixtureDir}${delimiter}${process.env.PATH ?? ''}`,
        },

        shell: false,

        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(invocation.stdin);
    });

    assert.equal(result.code, 0, result.stderr);
    const outputLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('["'));
    assert.ok(outputLine, result.stdout);
    assert.deepEqual(JSON.parse(outputLine), expectedArgs);
  },
);

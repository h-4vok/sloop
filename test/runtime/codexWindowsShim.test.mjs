import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'vitest';
import { codexCliInvocation } from '../../src/codex-cli.js';

test(
  'Windows bridge preserves literal percent and shell metacharacters through the global PowerShell shim',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const fixtureDir = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-global-codex-ps1-'));
    t.onTestFinished(() => rm(fixtureDir, { recursive: true, force: true }));
    await writeFile(
      join(fixtureDir, 'codex.ps1'),
      "& $env:SLOOP_NODE_EXE -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' @args; exit $LASTEXITCODE\n",
      'utf8',
    );

    const expectedArgs = [
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
    const invocation = codexCliInvocation(expectedArgs);
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const systemPath = [
      systemRoot,
      join(systemRoot, 'System32'),
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(delimiter);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: fixtureDir,

        env: {
          ...process.env,

          PATH: `${fixtureDir}${delimiter}${systemPath}`,

          SLOOP_NODE_EXE: process.execPath,
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

test(
  'Windows PowerShell shim fallback rejects empty arguments instead of dropping them',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const fixtureDir = createIsolatedTemporaryDirectory(
      join(tmpdir(), 'sloop-global-codex-empty-'),
    );
    t.onTestFinished(() => rm(fixtureDir, { recursive: true, force: true }));
    await writeFile(join(fixtureDir, 'codex.ps1'), "Write-Output 'shim was invoked'\n", 'utf8');

    const invocation = codexCliInvocation(['exec', '']);
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const systemPath = [
      systemRoot,
      join(systemRoot, 'System32'),
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(delimiter);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: fixtureDir,

        env: { ...process.env, PATH: `${fixtureDir}${delimiter}${systemPath}` },

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

    assert.equal(result.code, 127);
    assert.match(result.stderr, /cannot preserve empty arguments/);
    assert.doesNotMatch(result.stdout, /shim was invoked/);
  },
);

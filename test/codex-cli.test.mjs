import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'vitest';
import { codexCliInvocation } from '../src/codex-cli.js';

test('Codex CLI uses the global command directly outside Windows', () => {
  const args = ['exec', '--model', 'model-name', 'prompt text'];

  const invocation = codexCliInvocation(args, 'linux');

  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args, args);
  assert.equal(invocation.stdin, undefined);
});

test('Windows resolves the global Codex command and forwards argv as data', () => {
  const args = [
    'exec',
    '--model',
    'model-name',
    '',
    '2026-10-23T15:30:00Z',
    'prompt with $() and "quotes" ☃',
  ];

  const invocation = codexCliInvocation(args, 'win32');

  assert.equal(invocation.command, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
  assert.equal(invocation.args[3], '-EncodedCommand');
  const lines = invocation.stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), args.length);
  assert.equal(lines.at(-1), '');
  assert.deepEqual(
    encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8')),
    args,
  );
  const script = Buffer.from(invocation.args[4], 'base64').toString('utf16le');
  assert.match(script, /Get-Command codex\.exe/);
  assert.match(script, /Get-Command codex\.ps1/);
  assert.match(script, /Start-Process -FilePath \$codexCommand\.Source/);
  assert.match(script, /Quote-WindowsArgument/);
  assert.match(script, /& \$codexCommand\.Source @codexArgs/);
  assert.ok(!script.includes('& codex @codexArgs'));
  assert.ok(!script.includes(args.at(-1)));
});

test(
  'Windows bridge preserves empty and special arguments at the global CLI process boundary',
  { skip: process.platform !== 'win32' },
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
    const fixtureDir = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-global-codex-empty-'));
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

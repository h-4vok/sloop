import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { CliFailure } from '../dist/dispatcher.js';
import { emitDispatcherFailure, HELP, requireSupportedNode, runCli } from '../dist/cli.js';

const cli = resolve('dist/cli.js');

test('help documents the linked CLI contract', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Sloop 0\.1\.0/m);
  assert.match(result.stdout, /Usage: sloop <command> \[option\]/);
  assert.equal(result.stdout.trim(), HELP);
});

test('version reports the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('help and version cannot mask unsupported or mixed command arguments', () => {
  for (const args of [
    ['--help', '--repo', 'owner/other'],
    ['--version', '--list'],
    ['--repo', 'owner/other'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, /Command usage is invalid/);
    assert.equal(result.stdout, '');
  }
});

test('help and version work outside the Sloop checkout', () => {
  const outside = mkdtempSync(join(tmpdir(), 'sloop-cli-outside-'));
  try {
    for (const flag of ['--help', '--version']) {
      const result = spawnSync(process.execPath, [cli, flag], { cwd: outside, encoding: 'utf8' });
      assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
      assert.notEqual(result.stdout.trim(), '');
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('legacy dispatcher executable delegates through repository discovery', () => {
  const outside = mkdtempSync(join(tmpdir(), 'sloop-dispatcher-outside-'));
  try {
    const result = spawnSync(process.execPath, [resolve('dist/dispatcher.js'), '--status'], {
      cwd: outside,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not inside a Git repository/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('unsupported Node stops before dispatcher loading', () => {
  assert.throws(() => requireSupportedNode('v21.9.0'), /requires Node\.js 22 or newer.*v21\.9\.0/);
  const result = spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires Node\.js 22 or newer/);
  assert.equal(result.stdout, '');
});

test('unsupported Node emits the global envelope when JSON was requested', () => {
  const result = spawnSync(process.execPath, [cli, 'status', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, 'status');
  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.phase, 'preflight');
  assert.equal(envelope.diagnostics[0].check, 'node');
});

test('public dispatcher failure emitter preserves busy exit and stream contract', () => {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    assert.equal(emitDispatcherFailure(new CliFailure(3, 'Issue is already owned.')), 3);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['[sloop] Issue is already owned.']);
});

function captureConsole() {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  return {
    stdout,
    stderr,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

test('runCli preserves the public busy exit and human stream contract', async () => {
  const output = captureConsole();
  process.exitCode = undefined;
  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseReadOnlyCommand: () => undefined,
        runDispatcherPreflight: () => ({
          code: 0,
          diagnostics: [],
          root: '/repo',
          config: {},
          repository: 'owner/repo',
        }),
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: {
        runDispatcherCli: async () => {
          throw new CliFailure(3, 'Issue is already owned.');
        },
      },
      adapters: { productionDependencies: () => ({}) },
    });
    assert.equal(process.exitCode, 3);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.deepEqual(output.stdout, []);
  assert.deepEqual(output.stderr, ['[sloop] Issue is already owned.']);
});

test('runCli preserves the public blocked exit and JSON stream contract', async () => {
  const output = captureConsole();
  process.exitCode = undefined;
  try {
    await runCli(['status', '--json'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseReadOnlyCommand: () => ({ kind: 'status', json: true, verbose: false }),
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: () => {
          console.log(
            JSON.stringify({
              command: 'status',
              status: 'blocked',
              phase: 'workflow',
              summary: 'Workflow is blocked.',
              result: null,
              diagnostics: [],
              references: { issues: [31], pullRequests: [54] },
            }),
          );
          return 4;
        },
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
    assert.equal(process.exitCode, 4);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stderr.length, 0);
  assert.equal(output.stdout.length, 1);
  const envelope = JSON.parse(output.stdout[0]);
  assert.equal(envelope.status, 'blocked');
  assert.equal(envelope.phase, 'workflow');
  assert.deepEqual(envelope.references, { issues: [31], pullRequests: [54] });
});

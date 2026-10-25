import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import { ExternalServiceError } from '../src/core/ExternalServiceError.js';
import { CliFailure } from '../src/dispatcher.js';
import {
  createCli,
  createHelp,
  emitDispatcherFailure,
  requireSupportedNode,
  startCli,
} from '../src/application/cli/index.js';
import { createNodeHost } from '../src/infrastructure/host/index.js';
import { EXIT, resultOutput } from '../src/runtime.js';

const cli = resolve('dist/cli.js');
const versionPattern = /^\d+\.\d+\.\d+$/;
const packageVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const HELP = createHelp(packageVersion).text;
let activeOutput;

async function runCli(args, nodeVersion = process.version, modules) {
  const output = activeOutput ?? { stdout: [], stderr: [] };
  const logger = {
    log: (message) => output.stdout.push(message),
    error: (message) => output.stderr.push(message),
  };
  const compatibleModules = modules?.runtime?.parseCliCommand
    ? {
        ...modules,
        runtime: {
          ...modules.runtime,
          parseCliCommand: (...parseArgs) => {
            try {
              const parsed = modules.runtime.parseCliCommand(...parseArgs);
              return parsed && typeof parsed === 'object' && 'ok' in parsed
                ? parsed
                : { ok: true, value: parsed };
            } catch (error) {
              return { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          },
          discoverRepository: (...runtimeArgs) => {
            const discovered = modules.runtime.discoverRepository?.(...runtimeArgs);
            return discovered && typeof discovered === 'object' && 'ok' in discovered
              ? discovered
              : { ok: true, value: discovered };
          },
        },
      }
    : modules;
  const cliRunner = createCli({
    host: { ...createNodeHost(), nodeVersion },
    logger,
    version: packageVersion,
    modules: compatibleModules,
  });
  process.exitCode = await cliRunner.runCliCommand(args);
}

test('help documents the linked CLI contract', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Sloop \d+\.\d+\.\d+/m);
  assert.match(result.stdout, /Usage: sloop <command> \[option\]/);
  assert.match(result.stdout, /--prepare-recovery N \[--pr PR\]/);
  assert.match(result.stdout, /--resolve-review-cap --steer TEXT/);
  assert.match(result.stdout, /--additional-rounds N/);
  assert.match(result.stdout, /--waive Q1,Q2/);
  assert.match(result.stdout, /--waive-all-outstanding/);
  assert.match(result.stdout, /--abandon/);
  assert.equal(result.stdout.trim(), HELP);
});

test('version reports the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), versionPattern);
});

test('CLI bootstrap connects the production runner to its injected host and logger', async () => {
  const stdout = [];
  const stderr = [];
  process.exitCode = undefined;

  await startCli.start(['--version'], packageVersion, process.version, {
    host: createNodeHost(),
    logger: {
      log: (message) => stdout.push(message),
      error: (message) => stderr.push(message),
    },
  });

  assert.equal(process.exitCode, 0);
  assert.deepEqual(stdout, [packageVersion]);
  assert.deepEqual(stderr, []);
  process.exitCode = undefined;
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

test('unknown argv fails before dispatcher loading or preflight', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['--tuvieja'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: () => 2,
        parseCliCommand: () => {
          throw new Error('unknown option --tuvieja');
        },
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.deepEqual(output.stdout, []);
  assert.deepEqual(output.stderr, []);
});

test('runCli emits the public node-version failure through injected runtime seams', async () => {
  let received;
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--help'], 'v20.0.0', {
      runtime: {
        emitNodeVersionFailure: (args, version) => {
          received = [args, version];
          return 7;
        },
        emitUsageFailure: assert.fail,
        parseCliCommand: assert.fail,
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.deepEqual(received, [['--help'], 'v20.0.0']);
  assert.equal(exitCode, 7);
});

test('runCli reports non-Error usage failures', async () => {
  const output = captureCliOutput();
  const usageFailures = [];
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['unknown'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: (args, message) => {
          usageFailures.push([args, message]);
          return 9;
        },
        parseCliCommand: () => {
          throw 'plain failure';
        },
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
    output.restore();
  }

  assert.equal(exitCode, 9);
  assert.deepEqual(usageFailures, [[['unknown'], 'plain failure']]);
});

test('runCli falls back to general help for an unknown help target', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;
  try {
    await runCli(['help'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({ kind: 'help', target: 'unknown-target' }),
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
  } finally {
    process.exitCode = undefined;
    output.restore();
  }

  assert.deepEqual(output.stdout, [HELP]);
});

test('config show uses the production repository discovery and read-only configuration path', () => {
  const result = spawnSync(process.execPath, [cli, 'config', 'show'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^schemaVersion:/m);
});

test('runCli routes config commands through injected config adapters after discovery', async () => {
  const calls = [];
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({ kind: 'config', args: ['show'] }),
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
        discoverRepository: (io) => {
          assert.equal(typeof io.run, 'function');
          assert.equal(typeof io.readFile, 'function');
          assert.equal(io.run(process.execPath, ['--version']).status, 0);
          assert.match(io.readFile(resolve('package.json')), /"name": "sloop"/);
          return 'C:/isolated';
        },
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
      config: {
        productionConfigReconciler: (root) => {
          calls.push(['reconciler', root]);
          return async () => {};
        },
        runConfigCommand: {
          run: async (root, args, reconciler) => {
            calls.push(['run', root, args, typeof reconciler]);
            return 0;
          },
        },
      },
    });
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = undefined;
  }
  assert.deepEqual(calls, [
    ['reconciler', 'C:/isolated'],
    ['run', 'C:/isolated', ['show'], 'function'],
  ]);
});

test('config command emits a discovery diagnostic when repository discovery fails', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({ ok: true, value: { kind: 'config', args: ['show'] } }),
        discoverRepository: () => ({
          ok: false,
          error: {
            check: 'repository',
            message: 'The current directory is not inside a Git repository.',
            remediation: 'Change to the target repository.',
          },
        }),
        resultOutput,
        EXIT,
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: assert.fail,
      },
    });

    assert.equal(process.exitCode, EXIT.preflight);
    assert.match(output.stderr[0], /Repository startup failed/);
    assert.match(output.stderr[0], /\[repository\]/);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
});

test('runCli stops dispatcher execution when preflight fails', async () => {
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({
          ok: true,
          value: { kind: 'dispatcher', command: { kind: 'list' } },
        }),
        runDispatcherPreflight: () => ({ code: 6, diagnostics: [] }),
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: { runDispatcherCli: assert.fail },
      adapters: { productionDependencies: assert.fail },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.equal(exitCode, 6);
});

test('runner loads production dispatcher modules for dispatcher commands', async () => {
  const cliRunner = createCli({
    host: { ...createNodeHost(), nodeVersion: process.version },
    logger: { log: assert.fail, error: assert.fail },
    version: packageVersion,
    modules: {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({
          ok: true,
          value: { kind: 'dispatcher', command: { kind: 'list' } },
        }),
        runDispatcherPreflight: () => ({ code: 6, diagnostics: [] }),
        runReadOnlyCommand: assert.fail,
      },
    },
  });

  assert.equal(await cliRunner.runCliCommand(['--list']), 6);
});

test('runCli dispatches commands after successful preflight', async () => {
  const calls = [];
  let exitCode;
  process.exitCode = undefined;
  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({ kind: 'dispatcher', command: { kind: 'list' } }),
        runDispatcherPreflight: () => ({
          code: 0,
          diagnostics: [],
          root: '/repo',
          config: { mode: 'test' },
          repository: 'owner/repo',
        }),
        runReadOnlyCommand: assert.fail,
      },
      dispatcher: {
        runDispatcherCli: async (command, dependencies) => {
          calls.push(['dispatcher', command, dependencies]);
          return 0;
        },
      },
      adapters: {
        productionDependencies: (root, config, repository) => {
          calls.push(['dependencies', root, config, repository]);
          return { isolated: true };
        },
      },
    });
    exitCode = process.exitCode;
  } finally {
    process.exitCode = undefined;
  }

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    ['dependencies', '/repo', { mode: 'test' }, 'owner/repo'],
    ['dispatcher', { kind: 'list' }, { isolated: true }],
  ]);
});

test('CLI executes the production config imports in the current repository', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['config', 'show']);
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stderr.length, 0);
  assert.equal(output.stdout.length, 1);
});

test('help and version work outside the Sloop checkout', () => {
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-cli-outside-'));

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
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-outside-'));

  try {
    const result = spawnSync(process.execPath, [resolve('dist/dispatcher.js'), '--status'], {
      cwd: outside,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no longer supported; use `sloop status`/);
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
  const logger = {
    log: (message) => stdout.push(message),
    error: (message) => stderr.push(message),
  };

  assert.equal(emitDispatcherFailure(new CliFailure(3, 'Issue is already owned.'), logger), 3);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['[sloop] Issue is already owned.']);
});

test('public dispatcher failure emitter maps external service errors to exit 5', () => {
  const stdout = [];
  const stderr = [];
  const logger = {
    log: (message) => stdout.push(message),
    error: (message) => stderr.push(message),
  };
  const externalServiceError = new ExternalServiceError('github', 'GitHub request failed.');

  const exitCode = emitDispatcherFailure(externalServiceError, logger);

  assert.equal(exitCode, 5);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['[sloop] GitHub request failed.']);
});

function captureCliOutput() {
  const output = { stdout: [], stderr: [] };
  activeOutput = output;
  return {
    ...output,
    restore() {
      activeOutput = undefined;
    },
  };
}

test('runCli preserves the public busy exit and human stream contract', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['--list'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({ kind: 'dispatcher', command: { kind: 'list' } }),
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
  const output = captureCliOutput();
  process.exitCode = undefined;

  try {
    await runCli(['status', '--json'], process.version, {
      runtime: {
        emitNodeVersionFailure: assert.fail,
        emitUsageFailure: assert.fail,
        parseCliCommand: () => ({
          kind: 'read-only',
          command: { command: 'status', json: true, verbose: false },
        }),
        runDispatcherPreflight: assert.fail,
        runReadOnlyCommand: (_command, io) => {
          io.stdout(
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

test('runCli handles injected help and version commands without preflight', async () => {
  const output = captureCliOutput();
  process.exitCode = undefined;
  const parseResults = [{ kind: 'help', target: 'status' }, { kind: 'version' }];

  try {
    for (const command of parseResults) {
      await runCli(['status'], process.version, {
        runtime: {
          emitNodeVersionFailure: assert.fail,
          emitUsageFailure: assert.fail,
          parseCliCommand: () => command,
          runDispatcherPreflight: assert.fail,
          runReadOnlyCommand: assert.fail,
        },
        dispatcher: { runDispatcherCli: assert.fail },
        adapters: { productionDependencies: assert.fail },
      });
      assert.equal(process.exitCode, 0);
    }
  } finally {
    process.exitCode = undefined;
    output.restore();
  }
  assert.equal(output.stdout[0], 'Usage: sloop status [--verbose] [--json]');
  assert.match(output.stdout[1], versionPattern);
  assert.deepEqual(output.stderr, []);
});

test('the executable CLI wrapper forwards arguments and reports rejected startup', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTestNodeVersion = process.env.SLOOP_TEST_NODE_VERSION;
  const startCli = { start: vi.fn(async () => {}) };
  const loggerError = vi.fn();

  vi.doMock('../src/application/cli/index.js', () => ({ startCli }));
  vi.doMock('../src/infrastructure/index.js', () => ({
    consoleLogger: { error: loggerError },
  }));

  try {
    process.argv = [process.execPath, '/test/not-the-entrypoint.js'];
    vi.resetModules();
    const cliModule = await import('../src/cli.js');
    await cliModule.cli.runCli(['--version'], 'v22.1.0');

    assert.deepEqual(startCli.start.mock.calls[0], [['--version'], packageVersion, 'v22.1.0']);

    startCli.start.mockRejectedValueOnce(new Error('startup failed'));
    process.argv = [process.execPath, '/test/cli.js', 'status', '--json'];
    vi.resetModules();
    await import('../src/cli.js');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(process.exitCode, 2);
    assert.deepEqual(loggerError.mock.calls, [['[sloop] startup failed']]);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalTestNodeVersion === undefined) delete process.env.SLOOP_TEST_NODE_VERSION;
    else process.env.SLOOP_TEST_NODE_VERSION = originalTestNodeVersion;
    vi.doUnmock('../src/application/cli/index.js');
    vi.doUnmock('../src/infrastructure/index.js');
    vi.resetModules();
  }
});

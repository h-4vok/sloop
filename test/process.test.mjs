import assert from 'node:assert/strict';
import { test } from 'vitest';

const loadProcessAdapter = async () => {
  const { processAdapter } = await import('../src/process.ts');

  return processAdapter;
};

test('process root exports preserve the named compatibility API', async () => {
  const processModule = await import('../src/process.ts');

  assert.equal(processModule.resolveExecutable, processModule.processAdapter.resolveExecutable);
  assert.equal(processModule.runSyncCommand, processModule.processAdapter.runSyncCommand);
});

test('resolveExecutable keeps explicit paths and extensions unchanged', async () => {
  const { resolveExecutable } = await loadProcessAdapter();

  const resolvedCommands = [
    resolveExecutable('tool.exe', 'win32', () => ['tool.cmd']),
    resolveExecutable('/absolute/tool', 'win32', () => ['tool.cmd']),
  ];

  assert.deepEqual(resolvedCommands, ['tool.exe', '/absolute/tool']);
});

test('resolveExecutable falls back to the original command when lookup fails', async () => {
  const { resolveExecutable } = await loadProcessAdapter();

  const resolvedCommand = resolveExecutable('missing-tool', 'win32', () => {
    throw new Error('lookup failed');
  });

  assert.equal(resolvedCommand, 'missing-tool');
});

test('resolveExecutable covers host defaults and safely falls back for an impossible command', async () => {
  const { resolveExecutable } = await loadProcessAdapter();
  const missing = 'sloop-coverage-missing-command-7c3f2';

  // The no-argument call exercises the production platform default. Supplying
  // win32 below executes the production where.exe locator on every host; the
  // deliberately impossible command must always take its documented fallback.
  const defaultPlatformCommand = resolveExecutable(missing);
  const windowsCommand = resolveExecutable(missing, 'win32');

  assert.equal(defaultPlatformCommand, missing);
  assert.equal(windowsCommand, missing);
});

test('resolveExecutable prefers the Windows command shim', async () => {
  const { resolveExecutable } = await loadProcessAdapter();

  const resolvedCommand = resolveExecutable('npm', 'win32', () => ['npm.exe', 'npm.cmd']);

  assert.equal(resolvedCommand, 'npm.cmd');
});

test('resolveExecutable falls back to the first Windows command match', async () => {
  const { resolveExecutable } = await loadProcessAdapter();

  const resolvedCommand = resolveExecutable('npm', 'win32', () => ['npm.exe']);

  assert.equal(resolvedCommand, 'npm.exe');
});

test('resolveExecutable keeps the original command when no Windows match exists', async () => {
  const { resolveExecutable } = await loadProcessAdapter();

  const resolvedCommands = [
    resolveExecutable('npm', 'win32', () => ['npm']),
    resolveExecutable('npm', 'win32', () => []),
    resolveExecutable('npm', 'linux', () => ['npm.cmd']),
    resolveExecutable('/absolute/tool', 'linux', () => ['tool.cmd']),
    resolveExecutable('tool.exe', 'linux', () => ['tool.cmd']),
  ];

  assert.deepEqual(resolvedCommands, ['npm', 'npm', 'npm', '/absolute/tool', 'tool.exe']);
});

test('runSyncCommand trims output and passes direct-process options', async () => {
  const { runSyncCommand } = await loadProcessAdapter();
  const calls = [];

  const result = runSyncCommand(
    'node',
    ['--version'],
    (command, args, options) => {
      calls.push({ command, args, options });
      return ' output with whitespace \n';
    },
    'linux',
    undefined,
    'C:\\checkout',
  );

  assert.equal(result, 'output with whitespace');
  assert.deepEqual(calls, [
    {
      command: 'node',
      args: ['--version'],
      options: {
        cwd: 'C:\\checkout',
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: undefined,
      },
    },
  ]);
});

test('runSyncCommand uses its native executor when no test executor is supplied', async () => {
  const { runSyncCommand } = await loadProcessAdapter();

  const output = runSyncCommand(process.execPath, [
    '-e',
    "process.stdout.write(' native output ')",
  ]);

  assert.equal(output, 'native output');
});

test('batch invocation rejects command-parser metacharacters before launch', async () => {
  const { childProcessInvocation } = await loadProcessAdapter();

  const invokeUnsafeCommand = () =>
    childProcessInvocation('npm.cmd', ['run', 'test&whoami'], 'win32', 'cmd.exe');

  assert.throws(invokeUnsafeCommand, /unsafe cmd\.exe syntax/);
});

test('batch invocation quotes safe arguments when using cmd.exe', async () => {
  const { childProcessInvocation } = await loadProcessAdapter();

  const invocation = childProcessInvocation('npm.cmd', ['run', 'test'], 'win32', '');

  assert.deepEqual(invocation, {
    command: 'cmd.exe',
    args: ['/d', '/s', '/v:off', '/c', '\"\"npm.cmd\" \"run\" \"test\"\"'],
    windowsVerbatimArguments: true,
  });
});

test('batch invocation leaves executable calls unchanged when there are no arguments', async () => {
  const { childProcessInvocation } = await loadProcessAdapter();

  const invocation = childProcessInvocation('npm.exe', [], 'win32', 'cmd.exe');

  assert.deepEqual(invocation, {
    command: 'npm.exe',
    args: [],
  });
});

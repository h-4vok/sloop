import assert from 'node:assert/strict';
import test from 'node:test';

const processModule = () => import('../dist/process.js');

test('resolveExecutable keeps explicit paths and extensions unchanged', async () => {
  const { resolveExecutable } = await processModule();

  assert.equal(
    resolveExecutable('tool.exe', 'win32', () => ['tool.cmd']),
    'tool.exe',
  );
  assert.equal(
    resolveExecutable('C:\\tools\\tool', 'win32', () => ['tool.cmd']),
    'C:\\tools\\tool',
  );
});

test('resolveExecutable falls back to the original command when lookup fails', async () => {
  const { resolveExecutable } = await processModule();

  assert.equal(
    resolveExecutable('missing-tool', 'win32', () => {
      throw new Error('lookup failed');
    }),
    'missing-tool',
  );
});

test('runSyncCommand trims output and passes direct-process options', async () => {
  const { runSyncCommand } = await processModule();
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

test('batch invocation rejects command-parser metacharacters before launch', async () => {
  const { childProcessInvocation } = await processModule();

  assert.throws(
    () => childProcessInvocation('npm.cmd', ['run', 'test&whoami'], 'win32', 'cmd.exe'),
    /unsafe cmd\.exe syntax/,
  );
});

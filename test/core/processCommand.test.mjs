import assert from 'node:assert/strict';
import { test } from 'vitest';
const loadProcessAdapter = async () => {
  const { processAdapter } = await import('../../src/process.ts');
  return processAdapter;
};
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeHost } from '../../src/infrastructure/host/createNodeHost.js';

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

test.skipIf(process.platform !== 'win32')('NodeHost runs Windows batch executables', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'sloop-node-host-'));
  const commandPath = join(temporaryDirectory, 'version.cmd');
  writeFileSync(commandPath, '@echo off\r\necho shim works\r\n');
  const nodeHost = createNodeHost();

  try {
    const result = nodeHost.run(commandPath, [], temporaryDirectory);

    assert.deepEqual(
      { stdout: result.stdout.trim(), status: result.status },
      {
        stdout: 'shim works',

        status: 0,
      },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
const loadProcessAdapter = async () => {
  const { processAdapter } = await import('../../src/process.ts');
  return processAdapter;
};
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import { RunLogger, runDirectory } from '../../src/run-log.js';
import { command, runCommand } from '../../src/dispatcher.js';

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

test('real command execution captures Unicode and multiline stdout/stderr in arrival order', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'streams/✓'));
  const seen = [];
  const output = await runCommand(
    {
      ...command(
        {
          command: process.execPath,

          args: [
            '-e',
            "process.stdout.write('salut ✓\\nline two\\n'); process.stderr.write('ошибка\\nline err\\n')",
          ],
        },
        33,
      ),

      onStdout: (chunk) => {
        seen.push('stdout');
        logger.stream('stdout', chunk);
      },

      onStderr: (chunk) => {
        seen.push('stderr');
        logger.stream('stderr', chunk);
      },
    },
    root,
  );

  assert.match(output, /salut ✓/);
  const text = readFileSync(logger.file, 'utf8');
  assert.match(text, /ошибка/);
  assert.match(text, /line two/);
  assert.deepEqual(new Set(seen), new Set(['stdout', 'stderr']));
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_, index) => index + 1),
  );
});

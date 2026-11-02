import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  context,
  createMockCodexHarness,
  getLaunchedCodexArgs,
} from './support/harness-fixtures.mjs';

test('CodexHarness starts with typed CLI options, extracts the session, and logs raw output', async () => {
  const calls = [];
  const logs = [];
  const harness = createMockCodexHarness(
    {
      stdout: ['{"type":"thread.started","thread_id":"session-start"}\n', '{"type":"message"}\n'],

      stderr: ['diagnostic\n'],
    },
    calls,
    logs,
  );

  const result = await harness.start(context, { prompt: 'do the work' });

  assert.deepEqual(result, { accepted: true, session: 'session-start' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.deepEqual(getLaunchedCodexArgs(calls[0]), [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '--model',
    'gpt-5-codex',
    '--config',
    'model_reasoning_effort=high',
    'do the work',
  ]);
  assert.ok(getLaunchedCodexArgs(calls[0]).every((arg) => arg.length > 0));
  assert.deepEqual(logs, [
    ['stdout', '{"type":"thread.started","thread_id":"session-start"}\n'],
    ['stdout', '{"type":"message"}\n'],
    ['stderr', 'diagnostic\n'],
  ]);
  assert.equal(calls[0].options.cwd, 'fixture-repository');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, [
    process.platform === 'win32' ? 'pipe' : 'ignore',
    'pipe',
    'pipe',
  ]);
  if (process.platform === 'win32')
    assert.match(
      Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le'),
      /Get-Command codex\.exe/,
    );
});

test('CodexHarness returns completed agent messages as the turn output', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
    {
      stdout: [
        '{"type":"thread.started","thread_id":"session-start"}\n',
        '{"type":"item.completed","item":{"type":"agent_message","text":"WORKER_RESULT pr=35 base=main"}}\n',
      ],
    },
    calls,
  );

  const result = await harness.start(context, { prompt: 'finish the work' });

  assert.deepEqual(result, {
    accepted: true,

    session: 'session-start',

    output: 'WORKER_RESULT pr=35 base=main',
  });
});

test('CodexHarness accepts session IDs from alternate JSON event shapes', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
    { stdout: ['{"session_id":"session-alternate"}\n'] },
    calls,
  );

  const result = await harness.start(context, { prompt: 'read alternate session field' });

  assert.deepEqual(result, { accepted: true, session: 'session-alternate' });
});

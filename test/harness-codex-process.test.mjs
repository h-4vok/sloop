import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { CodexHarness, ResumeRejectedError } from '../src/harness.js';
import { context } from './support/harness-fixtures.mjs';

test('CodexHarness kills timed-out processes and rejects spawn errors', async () => {
  const timedOutChild = new EventEmitter();
  timedOutChild.stdout = new EventEmitter();
  timedOutChild.stderr = new EventEmitter();
  timedOutChild.stdin = { end: () => {} };
  timedOutChild.kill = () => queueMicrotask(() => timedOutChild.emit('close', null));
  const timedOutHarness = new CodexHarness({
    cwd: 'fixture-repository',

    model: 'gpt-5-codex',

    sandbox: 'workspace-write',

    reasoningEffort: 'high',

    timeoutMs: 1,

    spawn: () => timedOutChild,
  });

  await assert.rejects(
    () => timedOutHarness.start(context, { prompt: 'wait for timeout' }),
    ResumeRejectedError,
  );

  const failedChild = new EventEmitter();
  failedChild.stdout = new EventEmitter();
  failedChild.stderr = new EventEmitter();
  failedChild.stdin = { end: () => {} };
  failedChild.kill = () => {};
  const failedHarness = new CodexHarness({
    cwd: 'fixture-repository',

    model: 'gpt-5-codex',

    sandbox: 'workspace-write',

    reasoningEffort: 'high',

    timeoutMs: 1000,

    spawn: () => {
      queueMicrotask(() => failedChild.emit('error', new Error('spawn failed')));
      return failedChild;
    },
  });

  await assert.rejects(
    () => failedHarness.start(context, { prompt: 'fail to spawn' }),
    /spawn failed/,
  );
});

test('CodexHarness kills a child process when its output streams are unavailable', async () => {
  const childWithoutOutput = new EventEmitter();
  childWithoutOutput.stderr = new EventEmitter();
  childWithoutOutput.kill = () => {
    childWithoutOutput.wasKilled = true;
  };
  const harness = new CodexHarness({
    cwd: 'fixture-repository',

    model: 'gpt-5-codex',

    sandbox: 'workspace-write',

    reasoningEffort: 'high',

    timeoutMs: 1000,

    spawn: () => childWithoutOutput,
  });

  await assert.rejects(
    () => harness.start(context, { prompt: 'missing streams' }),
    /Codex process streams were not created/,
  );
  assert.equal(childWithoutOutput.wasKilled, true);
});

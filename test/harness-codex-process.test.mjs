import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { CodexHarness, ResumeRejectedError } from '../src/harness.js';
import { context } from './support/harness-fixtures.mjs';

test('CodexHarness rejects a process that exceeds its timeout', async () => {
  const child = createHarnessChild();
  child.kill = () => queueMicrotask(() => child.emit('close', null));
  const harness = createCodexHarness(child, 1);

  await assert.rejects(
    () => harness.start(context, { prompt: 'wait for timeout' }),
    ResumeRejectedError,
  );
});

test('CodexHarness rejects process startup errors', async () => {
  const child = createHarnessChild();
  const harness = createCodexHarness(child, 1000, () => {
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    return child;
  });

  await assert.rejects(() => harness.start(context, { prompt: 'fail to spawn' }), /spawn failed/);
});

function createHarnessChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: () => {} };
  child.kill = () => {};
  return child;
}

function createCodexHarness(child, timeoutMs, spawn = () => child) {
  return new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs,
    spawn,
  });
}
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

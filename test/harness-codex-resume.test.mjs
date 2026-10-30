import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ResumeAmbiguousError, ResumeRejectedError } from '../src/harness.js';
import {
  context,
  createMockCodexHarness,
  getLaunchedCodexArgs,
} from './support/harness-fixtures.mjs';

test('CodexHarness resumes the supplied opaque session and accepts a replacement', async () => {
  const calls = [];
  const harness = createMockCodexHarness(
    { stdout: ['{"type":"thread.started","thread_id":"session-next"}\n'] },
    calls,
  );

  const result = await harness.resume(context, { prompt: 'continue', session: 'session-old' });

  assert.deepEqual(result, { accepted: true, session: 'session-next' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.deepEqual(getLaunchedCodexArgs(calls[0]), [
    'exec',
    'resume',
    'session-old',
    '--json',
    '--model',
    'gpt-5-codex',
    '--config',
    'model_reasoning_effort=high',
    'continue',
  ]);
  assert.deepEqual(calls[0].options.stdio, [
    process.platform === 'win32' ? 'pipe' : 'ignore',
    'pipe',
    'pipe',
  ]);
});

test('CodexHarness rejects resume requests without a session reference', () => {
  const harness = createMockCodexHarness({ stdout: [] }, []);

  assert.throws(
    () => harness.resume(context, { prompt: 'resume without a reference', session: '' }),
    ResumeRejectedError,
  );
});

test('CodexHarness rejects successful output without a session ID', async () => {
  const harness = createMockCodexHarness({ stdout: ['{"type":"message"}\n'] }, []);

  await assert.rejects(
    () => harness.start(context, { prompt: 'missing id' }),
    /Codex completed without a valid session ID for issue #114/,
  );
});

test('CodexHarness distinguishes pre-turn rejection from an ambiguous started failure', async () => {
  const rejected = createMockCodexHarness({ stderr: ['invalid session\n'], code: 1 }, []);
  await assert.rejects(
    () => rejected.resume(context, { prompt: 'retry me', session: 'rejected' }),
    ResumeRejectedError,
  );

  const ambiguous = createMockCodexHarness({ stdout: ['{"type":"started"}\n'], code: 1 }, []);
  await assert.rejects(
    () => ambiguous.start(context, { prompt: 'do not retry' }),
    ResumeAmbiguousError,
  );
});

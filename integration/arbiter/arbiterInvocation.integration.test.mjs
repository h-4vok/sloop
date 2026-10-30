import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { CodexAgentRunner } from '../../src/agent-runner.js';

const context = {
  run: 'arbiter-run',
  issue: 41,
  pr: 73,
  round: 2,
  sha: 'abc123',
  cursor: 'arbiter-2',
};
const envelope = {
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'arbiter',

  status: 'defer',

  payload: {
    rationale: 'QA finding remains valid.',

    references: ['Q1'],

    decisions: [
      {
        findingId: 'Q1',

        owner: 'qa',

        action: 'uphold',

        rationale: 'Acceptance requires trimming.',

        direction: 'Trim input before display.',

        verification: 'Check surrounding whitespace.',

        followUp: null,
      },
    ],
  },
};

test('Arbiter launch uses read-only Codex structured output and declared temporary paths', async () => {
  // Arrange: process adapter is mocked; runner still creates and consumes real temp files.
  const root = await mkdtemp(join(tmpdir(), 'sloop-arbiter-invocation-'));
  const invocations = [];
  const runner = new CodexAgentRunner({
    cwd: root,

    sandbox: 'read-only',

    model: 'test-model',

    reasoningEffort: 'low',

    timeoutMs: 1000,

    execute: async (command, args, options) => {
      invocations.push({ command, args, options });
      const schema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      assert.equal(schema.$id, 'sloop.agent-output/v1');
      await writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(envelope));
      return { stdout: 'diagnostic text', stderr: '', code: 0, signal: null };
    },
  });

  try {
    // Act: execute the role adapter without starting Codex or making network calls.
    const result = await runner.run('review record', context);

    // Assert: argv and file boundary carry validated structured output.
    assert.equal(invocations.length, 1);
    const invocation = invocations[0];
    assert.equal(invocation.command, process.platform === 'win32' ? 'powershell.exe' : 'codex');
    const [argumentCount, ...encodedArguments] = invocation.options.stdin.split('\n');
    assert.equal(Number(argumentCount), encodedArguments.length - 1);
    const codexArguments = encodedArguments
      .slice(0, Number(argumentCount))
      .map((argument) => Buffer.from(argument, 'base64').toString('utf8'));
    assert.ok(codexArguments.includes('--sandbox'));
    assert.ok(codexArguments.includes('read-only'));
    assert.ok(codexArguments.includes('--output-schema'));
    assert.ok(codexArguments.includes('--output-last-message'));
    assert.ok(invocation.options.env.SLOOP_AGENT_INPUT.endsWith('input.json'));
    assert.ok(invocation.options.env.SLOOP_AGENT_OUTPUT.endsWith('output.json'));
    assert.equal(result.producer, 'arbiter');
    assert.equal(result.status, 'defer');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

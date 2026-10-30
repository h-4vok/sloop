import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFile as readFileFromFs } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import {
  AgentContractError,
  ArbitraryCommandRunner,
  CodexAgentRunner,
  validateAgentEnvelope,
} from '../../../src/agent-runner.js';

const context = { run: 'run-36', issue: 36, pr: 77, round: 2, sha: 'abc123', cursor: 'cursor' };

const guide = {
  summary: 'verify',

  steps: ['run'],

  expected: ['pass'],

  isolation: 'temp',

  limitations: ['fake'],

  checklist: ['check'],
};

const createWorkerEnvelope = () => ({
  schema: 'sloop.agent-output/v1',

  context,

  producer: 'worker',

  status: 'ready',

  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

test('runner handles durable write races and every result-read error family', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-race-'));
  const reconciliationDir = join(root, 'results');
  const input = 'race';
  const { createHash } = await import('node:crypto');
  const path = join(
    reconciliationDir,
    `${createHash('sha256')
      .update(JSON.stringify([input, context]))
      .digest('hex')}.json`,
  );
  await import('node:fs/promises').then(({ mkdir, writeFile }) =>
    mkdir(reconciliationDir, { recursive: true }).then(() => writeFile(path, 'not json')),
  );
  const raced = new ArbitraryCommandRunner('fake', [], {
    cwd: root,

    reconciliationDir,

    execute: async (_command, _args, options) => {
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });

  assert.equal((await raced.run(input, context)).status, 'ready');
  for (const mode of ['blank', 'directory']) {
    const runner = new ArbitraryCommandRunner('fake', [], {
      cwd: root,

      execute: async (_command, _args, options) => {
        await import('node:fs/promises').then(({ mkdir, writeFile }) =>
          mode === 'blank'
            ? writeFile(options.env.SLOOP_AGENT_OUTPUT, ' ')
            : mkdir(options.env.SLOOP_AGENT_OUTPUT),
        );
        return { stdout: '', stderr: '', code: 0, signal: null };
      },
    });
    await assert.rejects(
      runner.run(mode, context),
      (error) => error.code === 'missing-result' || error.code === 'malformed',
    );
  }
  await assert.rejects(
    new ArbitraryCommandRunner('fake', [], { cwd: root, retries: -1 }).run('none', context),
    (error) => error.code === 'missing-result',
  );
});

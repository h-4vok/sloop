import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, readFile as readFileFromFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentContractError,
  ArbitraryCommandRunner,
  CodexAgentRunner,
  validateAgentEnvelope,
} from '../dist/agent-runner.js';

const context = { run: 'run-36', issue: 36, pr: 77, round: 2, sha: 'abc123', cursor: 'cursor' };
const guide = {
  summary: 'verify',
  steps: ['run'],
  expected: ['pass'],
  isolation: 'temp',
  limitations: ['fake'],
  checklist: ['check'],
};
const worker = () => ({
  schema: 'sloop.agent-output/v1',
  context,
  producer: 'worker',
  status: 'ready',
  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

test('validates every role and rejects incomplete or contradictory payloads', () => {
  assert.equal(validateAgentEnvelope(worker(), context).status, 'ready');
  assert.throws(
    () =>
      validateAgentEnvelope(
        { ...worker(), producer: 'qa', status: 'accepted', payload: {} },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () =>
      validateAgentEnvelope(
        {
          ...worker(),
          producer: 'arbiter',
          status: 'uphold',
          payload: { rationale: 'r', references: [] },
        },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () =>
      validateAgentEnvelope(
        { ...worker(), payload: { ...worker().payload, extra: true } },
        context,
      ),
    AgentContractError,
  );
  assert.throws(
    () => validateAgentEnvelope({ ...worker(), context: { ...context, sha: 'stale' } }, context),
    AgentContractError,
  );
});

test('arbitrary runner reads only the declared result, captures streams, and retries launch failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-test-'));
  const logs = [];
  let attempts = 0;
  const runner = new ArbitraryCommandRunner('missing', [], {
    cwd: root,
    retries: 1,
    log: (source, chunk) => logs.push([source, chunk]),
    execute: async (_cmd, _args, options) => {
      attempts++;
      options.onStdout('{"status":"blocked"}');
      options.onStderr('diagnostic');
      if (attempts === 1) throw new Error('ENOENT');
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('{"instruction":"do it"}', context);
  assert.equal(result.status, 'ready');
  assert.equal(attempts, 2);
  assert.deepEqual(logs, [
    ['stdout', '{"status":"blocked"}'],
    ['stderr', 'diagnostic'],
    ['stdout', '{"status":"blocked"}'],
    ['stderr', 'diagnostic'],
  ]);
});

test('arbitrary runner executes the production child-process adapter for a valid envelope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-default-exec-'));
  const payload = JSON.stringify(worker());
  const script = [
    "const fs = require('node:fs');",
    "process.stdout.write('started');",
    "process.stderr.write('diagnostic');",
    `fs.writeFileSync(process.env.SLOOP_AGENT_OUTPUT, ${JSON.stringify(payload)});`,
  ].join('');
  const logs = [];
  const runner = new ArbitraryCommandRunner(process.execPath, ['-e', script], {
    cwd: root,
    log: (source, chunk) => logs.push([source, chunk]),
  });
  assert.equal((await runner.run('production adapter', context)).status, 'ready');
  assert.deepEqual(logs, [
    ['stdout', 'started'],
    ['stderr', 'diagnostic'],
  ]);
});

test('Codex runner builds separated structured-output argv and captures a result', async () => {
  let seen;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    model: 'm',
    reasoningEffort: 'high',
    sandbox: 'read-only',
    execute: async (command, args, options) => {
      seen = [command, args];
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      options.onStdout('marker-like json');
      options.onStderr('diagnostic');
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  assert.equal((await runner.run('prompt', context)).status, 'ready');
  assert.equal(seen[0], 'codex');
  assert.deepEqual(seen[1].slice(0, 8), [
    'exec',
    '--cd',
    process.cwd(),
    '--sandbox',
    'read-only',
    '--output-schema',
    seen[1][6],
    '--output-last-message',
  ]);
  assert.ok(seen[1].includes('prompt'));
});

test('non-interactive Codex structured-output smoke uses declared paths and one validated result', async () => {
  const events = [];
  let executable = '';
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    model: 'smoke-model',
    sandbox: 'read-only',
    timeoutMs: 1000,
    execute: async (command, args, options) => {
      executable = command;
      events.push(['argv', args]);
      const schema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      assert.equal(schema.$id, 'sloop.agent-output/v1');
      assert.ok(options.env.SLOOP_AGENT_INPUT.endsWith('input.json'));
      assert.ok(options.env.SLOOP_AGENT_OUTPUT.endsWith('output.json'));
      options.onStdout('diagnostic marker: {"status":"blocked"}');
      options.onStderr('isolated smoke diagnostic');
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
    log: (source, chunk) => events.push([source, chunk]),
  });
  const result = await runner.run('non-interactive smoke prompt', context);
  assert.equal(executable, 'codex');
  assert.equal(result.schema, 'sloop.agent-output/v1');
  assert.equal(result.status, 'ready');
  assert.equal(events[1][0], 'stdout');
  assert.equal(events[2][0], 'stderr');
  assert.ok(events[0][1].includes('--output-schema'));
  assert.ok(events[0][1].includes('--output-last-message'));
});

test('runner exposes the complete canonical schema and rejects operational failure matrix', async () => {
  const seen = [];
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    retries: 1,
    timeoutMs: 5,
    execute: async (_command, _args, options) => {
      seen.push(JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8')));
      if (seen.length === 1) return { stdout: '', stderr: 'crash', code: 1, signal: null };
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, '{"schema":"sloop.agent-output/v1"'),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await assert.rejects(runner.run('input', context), (error) => error.code === 'malformed');
  assert.equal(seen.length, 2);
  assert.ok(seen[0].$defs.worker);
  assert.ok(seen[0].$defs.reviewer);
  assert.ok(seen[0].$defs.arbiter);
  assert.equal(seen[0].$id, 'sloop.agent-output/v1');
  assert.equal(seen[0].oneOf.length, 3);
  assert.deepEqual(
    seen[0].oneOf.map((branch) => branch.properties.producer),
    [{ const: 'worker' }, { enum: ['qa', 'staff'] }, { const: 'arbiter' }],
  );
});

test('runner handles timeout, missing output, duplicate members, and idempotent valid retry', async () => {
  for (const mode of ['timeout', 'missing', 'duplicate']) {
    const runner = new ArbitraryCommandRunner('fake', [], {
      cwd: process.cwd(),
      timeoutMs: 1,
      execute: async (_command, _args, options) => {
        if (mode === 'timeout') return { stdout: '', stderr: '', code: null, signal: 'SIGTERM' };
        if (mode === 'duplicate')
          await import('node:fs/promises').then(({ writeFile }) =>
            writeFile(options.env.SLOOP_AGENT_OUTPUT, '{"schema":1,"schema":2}'),
          );
        return { stdout: '', stderr: '', code: 0, signal: null };
      },
    });
    await assert.rejects(runner.run('input', context), (error) =>
      ['operational-failure', 'missing-result', 'malformed'].includes(error.code),
    );
  }
  let calls = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    execute: async (_command, _args, options) => {
      calls++;
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  assert.equal((await runner.run('input', context)).status, 'ready');
  assert.equal((await runner.run('input', context)).status, 'ready');
  assert.equal(calls, 1);
});

test('declared schema resolves canonical role refs and reconciliation survives a new runner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-persist-'));
  const reconciliationDir = join(root, 'results');
  let calls = 0;
  const execute = async (_command, _args, options) => {
    calls++;
    const schema = JSON.parse(await readFileFromFs(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
    assert.ok(schema.$defs.worker);
    for (const file of ['worker.v1.json', 'reviewer.v1.json', 'arbiter.v1.json']) {
      assert.ok(await readFileFromFs(join(options.env.SLOOP_AGENT_SCHEMA, '..', file), 'utf8'));
    }
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
    );
    return { stdout: '', stderr: '', code: 0, signal: null };
  };
  const first = new ArbitraryCommandRunner('fake', [], { cwd: root, reconciliationDir, execute });
  assert.equal((await first.run('persisted input', context)).status, 'ready');
  const second = new ArbitraryCommandRunner('fake', [], {
    cwd: root,
    reconciliationDir,
    execute: async () => {
      throw new Error('must reconcile without execution');
    },
  });
  assert.equal((await second.run('persisted input', context)).status, 'ready');
  assert.equal(calls, 1);
});

test('runner handles durable write races and every result-read error family', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-race-'));
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
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
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

test('Codex runner applies its default sandbox', async () => {
  let args;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    execute: async (_command, received, options) => {
      args = received;
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          options.env.SLOOP_AGENT_OUTPUT,
          JSON.stringify({ ...worker(), context: { ...context, pr: undefined } }),
        ),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await runner.run('default sandbox', { ...context, pr: undefined });
  assert.equal(args[4], 'workspace-write');
});

test('runner reports non-Error launch failures and rethrows durable write failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloop-agent-durable-error-'));
  const launch = new ArbitraryCommandRunner('fake', [], {
    cwd: root,
    execute: async () => {
      throw 'missing executable';
    },
  });
  await assert.rejects(launch.run('launch', context), (error) =>
    /runner launch failed/.test(error.message),
  );
  const durable = new ArbitraryCommandRunner('fake', [], {
    cwd: root,
    reconciliationDir: join(root, 'results'),
    writeReconciliation: async () => {
      const error = new Error('cannot persist');
      Object.assign(error, { code: 'EACCES' });
      throw error;
    },
    execute: async (_command, _args, options) => {
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(worker())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await assert.rejects(durable.run('durable', context), (error) => error.code === 'malformed');
});

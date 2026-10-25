import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFile as readFileFromFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentContractError,
  ArbitraryCommandRunner,
  CodexAgentRunner,
  validateAgentEnvelope,
} from '../src/agent-runner.js';

const context = { run: 'run-36', issue: 36, pr: 77, round: 2, sha: 'abc123', cursor: 'cursor' };
const guide = {
  summary: 'verify',
  steps: ['run'],
  expected: ['pass'],
  isolation: 'temp',
  limitations: ['fake'],
  checklist: ['check'],
};
function decodeForwardedArguments(stdin, args) {
  if (stdin === undefined) return args;
  const lines = stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}
const createWorkerEnvelope = () => ({
  schema: 'sloop.agent-output/v1',
  context,
  producer: 'worker',
  status: 'ready',
  payload: { summary: 'done', findingResolutions: [], verification: ['test'], guide },
});

for (const [condition, payload] of [
  ['missing decisions', { rationale: 'Trim names.', references: ['Q1'] }],
  ['empty decisions', { rationale: 'Trim names.', references: ['Q1'], decisions: [] }],
  ['malformed decisions', { rationale: 'Trim names.', references: ['Q1'], decisions: [null] }],
  ['empty references', { rationale: 'Trim names.', references: [], decisions: [{}] }],
]) {
  test(`Arbiter envelope rejects ${condition}`, () => {
    const envelope = { ...createWorkerEnvelope(), producer: 'arbiter', status: 'uphold', payload };

    assert.throws(() => validateAgentEnvelope(envelope, context), AgentContractError);
  });
}

test('accepts a complete Worker envelope', () => {
  const workerEnvelope = createWorkerEnvelope();

  const result = validateAgentEnvelope(workerEnvelope, context);

  assert.equal(result.status, 'ready');
});

test('rejects an incomplete QA envelope', () => {
  const invalidQaEnvelope = {
    ...createWorkerEnvelope(),
    producer: 'qa',
    status: 'accepted',
    payload: {},
  };

  const validateInvalidQaEnvelope = () => validateAgentEnvelope(invalidQaEnvelope, context);

  assert.throws(validateInvalidQaEnvelope, AgentContractError);
});

test('rejects an Arbiter envelope with no finding references', () => {
  const invalidArbiterEnvelope = {
    ...createWorkerEnvelope(),
    producer: 'arbiter',
    status: 'uphold',
    payload: { rationale: 'r', references: [] },
  };

  const validateInvalidArbiterEnvelope = () =>
    validateAgentEnvelope(invalidArbiterEnvelope, context);

  assert.throws(validateInvalidArbiterEnvelope, AgentContractError);
});

test('rejects Worker payload fields outside the declared schema', () => {
  const workerEnvelope = createWorkerEnvelope();
  const invalidWorkerEnvelope = {
    ...workerEnvelope,
    payload: { ...workerEnvelope.payload, extra: true },
  };

  const validateUnexpectedPayloadField = () =>
    validateAgentEnvelope(invalidWorkerEnvelope, context);

  assert.throws(validateUnexpectedPayloadField, AgentContractError);
});

test('rejects an agent envelope with a stale context SHA', () => {
  const staleContextEnvelope = {
    ...createWorkerEnvelope(),
    context: { ...context, sha: 'stale' },
  };

  const validateStaleContextEnvelope = () => validateAgentEnvelope(staleContextEnvelope, context);

  assert.throws(validateStaleContextEnvelope, AgentContractError);
});

test('arbitrary runner reads only the declared result, captures streams, and retries launch failures', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-test-'));
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
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
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
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-default-exec-'));
  const payload = JSON.stringify(createWorkerEnvelope());
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

test('default process adapter reports a timeout as an operational failure', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-timeout-'));
  const runner = new ArbitraryCommandRunner(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 1000)'],
    { cwd: root, timeoutMs: 10 },
  );

  await assert.rejects(
    () => runner.run('input', context),
    (error) => {
      assert.ok(error instanceof AgentContractError);
      assert.equal(error.code, 'operational-failure');
      return true;
    },
  );
});

test('Codex runner builds separated structured-output argv and captures a result', async () => {
  let seen;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    model: 'm',
    reasoningEffort: 'high',
    sandbox: 'read-only',
    execute: async (command, args, options) => {
      seen = [command, args, options.stdin];
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      options.onStdout('marker-like json');
      options.onStderr('diagnostic');
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });

  assert.equal((await runner.run('prompt', context)).status, 'ready');
  assert.equal(seen[0], process.platform === 'win32' ? 'powershell.exe' : 'codex');
  const codexArgs = decodeForwardedArguments(seen[2], seen[1]);
  assert.ok(codexArgs.every((arg) => arg.length > 0));
  assert.deepEqual(codexArgs.slice(0, 7), [
    'exec',
    '--cd',
    process.cwd(),
    '--sandbox',
    'read-only',
    '--output-schema',
    codexArgs[6],
  ]);
  assert.ok(codexArgs.includes('prompt'));
});

test('non-interactive Codex structured-output smoke uses declared paths and one validated result', async () => {
  const events = [];
  let invocation;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    model: 'smoke-model',
    sandbox: 'read-only',
    timeoutMs: 1000,
    execute: async (command, args, options) => {
      invocation = { command, args, stdin: options.stdin };
      events.push(['argv', args]);
      const schema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      assert.equal(schema.$id, 'sloop.agent-output/v1');
      assert.ok(options.env.SLOOP_AGENT_INPUT.endsWith('input.json'));
      assert.ok(options.env.SLOOP_AGENT_OUTPUT.endsWith('output.json'));
      options.onStdout('diagnostic marker: {"status":"blocked"}');
      options.onStderr('isolated smoke diagnostic');
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
    log: (source, chunk) => events.push([source, chunk]),
  });
  const result = await runner.run('non-interactive smoke prompt', context);

  assert.equal(invocation.command, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  const codexArgs = decodeForwardedArguments(invocation.stdin, invocation.args);
  assert.equal(result.schema, 'sloop.agent-output/v1');
  assert.equal(result.status, 'ready');
  assert.equal(events[1][0], 'stdout');
  assert.equal(events[2][0], 'stderr');
  assert.ok(codexArgs.includes('--output-schema'));
  assert.ok(codexArgs.includes('--output-last-message'));
});

test('runner exposes the canonical schema for every agent role', async () => {
  let observedSchema;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    execute: async (_command, _args, options) => {
      observedSchema = JSON.parse(await readFile(options.env.SLOOP_AGENT_SCHEMA, 'utf8'));
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('input', context);

  assert.equal(result.status, 'ready');
  assert.ok(observedSchema.$defs.worker);
  assert.ok(observedSchema.$defs.reviewer);
  assert.ok(observedSchema.$defs.arbiter);
  assert.equal(observedSchema.$id, 'sloop.agent-output/v1');
  assert.equal(observedSchema.oneOf.length, 3);
  assert.deepEqual(
    observedSchema.oneOf.map((branch) => branch.properties.producer),
    [{ const: 'worker' }, { enum: ['qa', 'staff'] }, { const: 'arbiter' }],
  );
});

test('runner retries a failed process before returning a valid result', async () => {
  let attempts = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    retries: 1,
    execute: async (_command, _args, options) => {
      attempts++;
      if (attempts === 1) return { stdout: '', stderr: 'crash', code: 1, signal: null };
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const result = await runner.run('input', context);

  assert.equal(result.status, 'ready');
  assert.equal(attempts, 2);
});

for (const [condition, expectedCode, mode] of [
  ['a timed-out process', 'operational-failure', 'timeout'],
  ['a missing result file', 'missing-result', 'missing'],
  ['duplicate JSON members', 'malformed', 'duplicate'],
]) {
  test(`runner rejects ${condition}`, async () => {
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
    const execution = runner.run('input', context);

    await assert.rejects(execution, (error) => error.code === expectedCode);
  });
}

test('runner returns a persisted valid result without executing a duplicate attempt', async () => {
  let calls = 0;
  const runner = new ArbitraryCommandRunner('fake', [], {
    cwd: process.cwd(),
    execute: async (_command, _args, options) => {
      calls++;
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  const firstResult = await runner.run('input', context);
  const secondResult = await runner.run('input', context);

  assert.equal(firstResult.status, 'ready');
  assert.equal(secondResult.status, 'ready');
  assert.equal(calls, 1);
});

test('declared schema resolves canonical role refs and reconciliation survives a new runner', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-persist-'));
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
      writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
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

test('Codex runner applies its default sandbox', async () => {
  let args;
  const runner = new CodexAgentRunner({
    cwd: process.cwd(),
    execute: async (_command, received, options) => {
      args = decodeForwardedArguments(options.stdin, received);
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          options.env.SLOOP_AGENT_OUTPUT,
          JSON.stringify({ ...createWorkerEnvelope(), context: { ...context, pr: undefined } }),
        ),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await runner.run('default sandbox', { ...context, pr: undefined });

  assert.equal(args[4], 'workspace-write');
});

test('runner reports non-Error launch failures and rethrows durable write failures', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-agent-durable-error-'));
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
        writeFile(options.env.SLOOP_AGENT_OUTPUT, JSON.stringify(createWorkerEnvelope())),
      );
      return { stdout: '', stderr: '', code: 0, signal: null };
    },
  });
  await assert.rejects(durable.run('durable', context), (error) => error.code === 'malformed');
});

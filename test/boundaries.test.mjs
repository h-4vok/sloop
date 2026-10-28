import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { productionDependencies } from '../src/adapters.js';

import { loadConfigText, canonicalConfigYaml } from '../src/config.js';
import { CliFailure } from '../src/dispatcher.js';
import { runManifestMarker } from '../src/remote-state.js';

function decodeForwardedArguments(stdin, args) {
  if (stdin === undefined) return args;
  const lines = stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

function createMockFollowUpIssueHarness(hasFollowUpIssue) {
  const calls = [];
  const key = 'sloop/arbiter/follow-up/41/Q1';
  const execute = (_file, args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'list')
      return hasFollowUpIssue
        ? JSON.stringify([{ number: 88, body: `Idempotency key: ${key}` }])
        : '[]';
    return 'https://github.com/h-4vok/sloop/issues/99';
  };
  const dependencies = productionDependencies(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-issue-')),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
    { execFileSync: execute },
  );

  return { calls, dependencies, key };
}

test('production assembly supplies every typed external-concern boundary', () => {
  const dependencies = productionDependencies(
    process.cwd(),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
  );
  const methods = {
    Workspace: ['load', 'save'],

    CliControl: [
      'loadConfig',
      'status',
      'list',
      'recoverLock',
      'reset',
      'resolveReviewCap',
      'linkIssue',
      'prepareRecovery',
    ],

    GitProvider: ['prepareWorkerBranch', 'checkoutWorkerBranch'],

    GitHubProvider: [
      'eligible',
      'comment',
      'pullRequest',
      'updatePullRequestBody',
      'pullRequestBody',
      'prComment',
    ],

    AgentRunner: ['run'],

    HealthGate: ['pid', 'processAlive'],

    LockStore: [
      'tryAcquire',
      'readOwner',
      'tryBeginReclaim',
      'readReclaimOwner',
      'reclaimAgeMs',
      'finishReclaim',
      'abandonReclaim',
      'release',
    ],

    Scheduler: ['now', 'sleep'],

    RunEventSink: ['onReclaim'],
  };

  for (const [boundary, members] of Object.entries(methods))
    for (const member of members)
      assert.equal(typeof dependencies[member], 'function', `${boundary}.${member} is required`);
});

test('production adapters sanitize every GitHub body and marker publication path', () => {
  const calls = [];
  const execute = (file, args, options) => {
    const call = { file, args: [...args], options };
    if (args.includes('--body-file'))
      call.body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    calls.push(call);
    if (args.includes('--json')) return JSON.stringify({ labels: [], comments: [] });
    return '';
  };
  const dependencies = productionDependencies(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-test-')),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
    { execFileSync: execute },
  );
  const body = [
    'Authorization: Bearer bearer-secret',
    'Cookie: sid=cookie-secret',
    'https://user:password-secret@example.test/path',
    JSON.stringify({ nested: { accessToken: 'nested-secret', raw: 'local-only' } }),
  ].join('\n');

  dependencies.comment(33, body);
  dependencies.prComment(76, body);
  dependencies.updatePullRequestBody(76, body);
  dependencies.remote.claim(33, 'owner', '2026-09-10T00:00:00.000Z');

  const publications = calls.filter((call) => call.args.includes('--body') || call.body);

  assert.equal(publications.length, 4);
  const published = publications
    .map((call) => call.body ?? call.args[call.args.indexOf('--body') + 1])
    .join('\n');
  for (const secret of ['bearer-secret', 'cookie-secret', 'password-secret', 'nested-secret'])
    assert.equal(published.includes(secret), false, `secret leaked: ${secret}`);
  assert.match(published, /Authorization: <redacted>/);
  assert.match(published, /Cookie: <redacted>/);
  assert.match(published, /https:\/\/<redacted>@example\.test/);
  assert.match(published, /"accessToken":<redacted>/);
  assert.match(published, /sloop\/v1\/lease\/33\/owner\//);
});

test('production adapters reuse an existing Arbiter follow-up issue', () => {
  const { calls, dependencies, key } = createMockFollowUpIssueHarness(true);
  const issueNumber = dependencies.createIssue('follow-up', `Idempotency key: ${key}\n\nFollow-up`);

  assert.equal(issueNumber, 88);
  assert.equal(calls.filter((args) => args[0] === 'issue' && args[1] === 'create').length, 0);
});

test('production adapters create a missing Arbiter follow-up issue', () => {
  const { calls, dependencies, key } = createMockFollowUpIssueHarness(false);
  const issueNumber = dependencies.createIssue('follow-up', `Idempotency key: ${key}\n\nFollow-up`);

  assert.equal(issueNumber, 99);
  assert.equal(calls.filter((args) => args[0] === 'issue' && args[1] === 'create').length, 1);
});

test('remote snapshot keeps --repo off gh api GraphQL calls', () => {
  const calls = [];
  const manifest = {
    protocol: 1,

    runId: 'run-1',

    issue: 33,

    pr: 77,

    branch: 'codex/issue-33',

    baseSha: 'abcdef1',

    configFingerprint: 'config-1',

    phase: 'review',

    reviewRound: 1,

    contextCursor: 'cursor-1',

    artifacts: [],
  };
  const execute = (file, args, options) => {
    calls.push({ file, args: [...args], options });
    if (args[0] === 'issue')
      return JSON.stringify({ labels: [], comments: [{ body: runManifestMarker(manifest) }] });
    if (args[0] === 'pr')
      return JSON.stringify({ number: 77, comments: [], reviews: [], statusCheckRollup: [] });
    if (args[0] === 'api')
      return JSON.stringify({
        data: {
          repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } },
        },
      });
    throw new Error(`unexpected gh command: ${args.join(' ')}`);
  };
  const dependencies = productionDependencies(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-test-')),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
    { execFileSync: execute },
  );

  const snapshot = dependencies.remote.snapshot(33);
  const apiCall = calls.find((call) => call.args[0] === 'api');

  assert.ok(apiCall);
  assert.equal(apiCall.args.includes('--repo'), false);
  assert.deepEqual(snapshot.inlineThreads, [{ resolved: false }]);
});

test('typed CLI failures preserve stable busy and external exit classes', () => {
  const exitCodes = [
    new CliFailure(3, 'owned').exitCode,
    new CliFailure(5, 'HTTP 503: Service Unavailable').exitCode,
  ];

  assert.deepEqual(exitCodes, [3, 5]);
});

test('production adapters run agent commands from the repository root', async () => {
  const config = loadConfigText(canonicalConfigYaml());
  const dependencies = productionDependencies(process.cwd(), config, 'h-4vok/sloop');
  const output = await dependencies.run({
    command: process.execPath,

    args: ['-e', 'process.stdout.write(process.cwd())'],

    timeoutMs: 5_000,

    retries: 0,

    logInvocation: false,
  });

  assert.equal(output, process.cwd());
});

test('production adapters load the validated YAML agent configuration', () => {
  const config = loadConfigText(canonicalConfigYaml());
  const dependencies = productionDependencies(process.cwd(), config, 'h-4vok/sloop');
  const loadedConfig = dependencies.loadConfig();

  assert.equal(loadedConfig.baseBranch, config.repository.baseBranch);
  assert.deepEqual(loadedConfig.workerCommand, {
    command: 'codex',

    args: [],

    timeoutMs: config.agents.worker.timeout,

    retries: config.agents.worker.retries,

    sessions: true,
  });
});

test('production adapter passes explicit full access to the Codex harness', async () => {
  const config = loadConfigText(
    canonicalConfigYaml().replaceAll('workspace-write', 'danger-full-access'),
  );
  const calls = [];
  const dependencies = productionDependencies(process.cwd(), config, 'h-4vok/sloop', {
    codexSpawn(file, args, options) {
      const child = new EventEmitter();
      child.stdin = { end: (chunk) => (child.input = chunk) };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      calls.push({ file, args, options, child });
      queueMicrotask(() => {
        child.stdout.emit('data', '{"type":"thread.started","thread_id":"full-access-session"}\n');
        child.emit('close', 0);
      });
      return child;
    },
  });
  const harness = dependencies.harness('worker', { timeoutMs: 1_000 }, {}, { write: () => {} });

  const result = await harness.start(
    { issue: 1, role: 'worker', run: 'run-a', repository: 'owner/repo', issueContext: 'test' },
    { prompt: 'continue' },
  );

  assert.deepEqual(result, { accepted: true, session: 'full-access-session' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.equal(calls[0].options.shell, false);
  const codexArgs = decodeForwardedArguments(calls[0].child.input, calls[0].args);
  assert.equal(codexArgs[codexArgs.indexOf('--sandbox') + 1], 'danger-full-access');
});

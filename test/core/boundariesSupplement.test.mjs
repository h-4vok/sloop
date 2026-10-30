import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { productionDependencies } from '../../src/adapters.js';
import { loadConfigText, canonicalConfigYaml } from '../../src/config.js';
import { CliFailure } from '../../src/dispatcher.js';
import { runManifestMarker } from '../../src/remote-state.js';

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

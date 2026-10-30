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

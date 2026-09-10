import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { productionDependencies } from '../dist/adapters.js';
import { loadConfigText, canonicalConfigYaml } from '../dist/config.js';
import { CliFailure } from '../dist/dispatcher.js';

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
    mkdtempSync(join(tmpdir(), 'sloop-adapter-test-')),
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

test('typed CLI failures preserve stable busy and external exit classes', () => {
  assert.equal(new CliFailure(3, 'owned').exitCode, 3);
  assert.equal(new CliFailure(5, 'HTTP 503: Service Unavailable').exitCode, 5);
});

test('production adapters root agent execution and use the validated YAML configuration', async () => {
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
  assert.equal(dependencies.loadConfig().baseBranch, config.repository.baseBranch);
  assert.deepEqual(
    dependencies.loadConfig().workerCommand.args,
    config.agents.worker.argv.slice(1),
  );
});

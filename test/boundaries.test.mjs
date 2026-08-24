import assert from 'node:assert/strict';
import { test } from 'node:test';
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

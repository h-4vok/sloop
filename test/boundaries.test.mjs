import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionDependencies } from '../dist/adapters.js';

test('production assembly supplies every typed external-concern boundary', () => {
  const dependencies = productionDependencies(process.cwd());
  const methods = {
    Workspace: ['load', 'save'],
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

import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { runManifestMarker } from '../../../src/remote-state.js';

test('production adapters cover alternate payload fields and lock error recovery', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-alternates-'));
  const config = loadConfigText(canonicalConfigYaml());
  const dependencies = productionDependencies(root, config, 'owner/repo', {
    execFileSync: (_file, args) => {
      if (args[0] === 'pr')
        return JSON.stringify({
          number: 3,

          state: 'OPEN',

          baseRefName: 'main',

          headRefName: 'branch',

          headRefOid: 'sha',

          merge_state_status: 'CLEAN',

          reviews: [{ body: 'r', state: 'COMMENTED', commit_id: 'c', submittedAt: 'now' }],

          comments: [{ body: 'c', createdAt: 'now' }],

          statusCheckRollup: [{ workflowName: 'ci', state: 'SUCCESS', detailsUrl: 'u' }],
        });
      return JSON.stringify({ body: undefined });
    },
  });

  assert.equal(dependencies.pullRequest(3).mergeStateStatus, 'CLEAN');
  assert.equal(dependencies.pullRequest(3).reviews[0].commitId, 'c');
  assert.equal(dependencies.pullRequest(3).statusCheckRollup[0].name, 'ci');
  assert.equal(dependencies.pullRequestBody(3), '');
  assert.equal(dependencies.loadConfig().baseBranch, 'main');
  const invalidRepository = productionDependencies(root, config, 'invalid', {
    execFileSync: (_file, args) =>
      args[0] === 'issue'
        ? JSON.stringify({ comments: [{ body: runManifestMarker({ ...manifest, issue: 1 }) }] })
        : JSON.stringify({}),
  });
  assert.throws(() => invalidRepository.remote.snapshot(1), /GitHub snapshot unavailable/);
  const lock = productionDependencies(root, config, 'owner/repo', {
    execFileSync: () => JSON.stringify({}),
  });
  assert.equal(lock.tryAcquire({ pid: 1, createdAt: 1, token: 'base' }), true);
  assert.equal(lock.tryBeginReclaim({ pid: 1, createdAt: 1, token: 'x' }), true);
  assert.equal(lock.tryBeginReclaim({ pid: 1, createdAt: 1, token: 'y' }), false);
  lock.abandonReclaim();
  assert.throws(() => lock.readReclaimOwner());
  lock.release('base');
  lock.release('missing-owner');
});

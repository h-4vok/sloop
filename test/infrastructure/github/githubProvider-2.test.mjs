import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import { test } from 'vitest';

import assert from 'node:assert/strict';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { runManifestMarker } from '../../../src/remote-state.js';

test('production adapters exercise empty and alternate GitHub response shapes', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-shapes-'));
  const config = loadConfigText(canonicalConfigYaml());
  let mode = 'empty';
  const dependencies = productionDependencies(root, config, 'owner/repo', {
    execFileSync: (_file, args) => {
      if (args[0] === 'pr')
        return mode === 'empty'
          ? JSON.stringify({})
          : JSON.stringify({
              number: 4,

              reviews: [{ commitId: 'id', submittedAt: 'date' }],

              comments: [{ body: 'comment', createdAt: 'date' }],

              statusCheckRollup: [{ context: 'context', state: 'PENDING' }],
            });
      return JSON.stringify({});
    },
  });
  const empty = dependencies.pullRequest(4);

  assert.deepEqual(empty.reviews, []);
  assert.deepEqual(empty.comments, []);
  assert.deepEqual(empty.statusCheckRollup, []);
  mode = 'alternate';
  assert.equal(dependencies.pullRequest(4).reviews[0].commitId, 'id');
  assert.equal(dependencies.pullRequest(4).statusCheckRollup[0].name, 'context');
  const snapshot = dependencies.remote.snapshot(4);
  assert.deepEqual(snapshot.labels, []);
  assert.deepEqual(snapshot.comments, []);
  assert.equal(snapshot.pr, undefined);
  dependencies.remote.claim(4, 'key', {
    protocol: 1,

    runId: 'run',

    issue: 4,

    branch: 'branch',

    baseSha: 'sha',

    configFingerprint: 'cfg',

    phase: 'working',

    reviewRound: 0,

    contextCursor: '',
  });
  dependencies.remote.publish(4, {
    protocol: 1,

    runId: 'run',

    issue: 4,

    branch: 'branch',

    baseSha: 'sha',

    configFingerprint: 'cfg',

    phase: 'working',

    reviewRound: 0,

    contextCursor: '',

    artifacts: [],
  });
  const fallbackManifest = {
    protocol: 1,

    runId: 'fallback',

    issue: 4,

    pr: 4,

    branch: 'branch',

    baseSha: 'sha',

    configFingerprint: 'cfg',

    phase: 'working',

    reviewRound: 0,

    contextCursor: '',

    artifacts: [],
  };
  const manifestExecutor = productionDependencies(root, config, 'owner/repo', {
    execFileSync: (_file, args) => {
      if (args[0] === 'issue')
        return JSON.stringify({
          comments: [
            {
              body: runManifestMarker({
                ...fallbackManifest,

                issue: 4,

                pr: 4,
              }),
            },
          ],
        });
      if (args[0] === 'pr') return JSON.stringify({});
      return JSON.stringify({});
    },
  });
  manifestExecutor.remote.snapshot(4);
  const nonError = productionDependencies(root, config, 'owner/repo', {
    execFileSync: () => {
      throw 'offline';
    },
  });
  assert.throws(() => nonError.remote.snapshot(4), /GitHub snapshot unavailable: offline/);
  assert.throws(
    () => nonError.remote.reconcile(4, 'x'),
    /GitHub reconciliation unavailable: offline/,
  );
  assert.throws(() => nonError.remote.claim(4, 'x', 'y'), /offline/);
  assert.throws(
    () => nonError.remote.publish(4, { ...fallbackManifest, artifacts: [] }),
    /offline/,
  );
});

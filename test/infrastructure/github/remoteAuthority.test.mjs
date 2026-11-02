import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import { test } from 'vitest';

import assert from 'node:assert/strict';

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { execFileSync } from 'node:child_process';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { ExternalServiceError } from '../../../src/core/ExternalServiceError.js';

import { runManifestMarker } from '../../../src/remote-state.js';

function createAdapterDependenciesWithMockGitHubCommand(execute) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

test('adapter reconciles a previously published artifact key', () => {
  const calls = [];
  const dependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args.includes('--json'))
      return JSON.stringify({ comments: [{ body: 'artifact-key' }] });
    return '';
  });
  const isReconciled = dependencies.remote.reconcile(81, 'artifact-key');

  assert.equal(isReconciled, true);
  assert.ok(calls.some((args) => args[0] === 'issue' && args[1] === 'view'));
});

test('adapter rejects a malformed pull-request snapshot', () => {
  const dependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    if (args[0] === 'issue')
      return JSON.stringify({
        labels: [],

        comments: [
          {
            body: runManifestMarker({
              protocol: 1,

              runId: 'x',

              issue: 81,

              pr: 9,

              branch: 'b',

              baseSha: 'abcdef1',

              configFingerprint: 'cfg',

              phase: 'working',

              reviewRound: 1,

              contextCursor: '',

              artifacts: [],
            }),
          },
        ],
      });
    if (args[0] === 'pr') return '{not-json';
    return '';
  });

  assert.throws(() => dependencies.remote.snapshot(81), /GitHub snapshot unavailable/);
});

test('adapter allows only one active lock owner', () => {
  const dependencies = createAdapterDependenciesWithMockGitHubCommand(() => '');
  const firstOwner = { pid: 1, createdAt: 1, token: 't' };
  const secondOwner = { pid: 2, createdAt: 2, token: 'u' };
  const hasFirstLock = dependencies.tryAcquire(firstOwner);
  const hasSecondLock = dependencies.tryAcquire(secondOwner);

  dependencies.release(firstOwner.token);

  assert.deepEqual([hasFirstLock, hasSecondLock], [true, false]);
});

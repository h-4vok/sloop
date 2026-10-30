import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';

import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { test, vi } from 'vitest';

import { productionConfigReconciler, productionDependencies } from '../../../src/adapters.js';

import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';

import { runManifestMarker } from '../../../src/remote-state.js';

const createTemporaryDirectory = (prefix) =>
  createIsolatedTemporaryDirectory(join(tmpdir(), prefix));

const createTestRunManifest = (overrides = {}) => ({
  protocol: 1,

  runId: 'adapter-run',

  issue: 81,

  pr: 9,

  branch: 'codex/issue-81-x',

  baseSha: 'abcdef1',

  configFingerprint: 'config',

  phase: 'working',

  reviewRound: 1,

  contextCursor: '',

  artifacts: [],

  ...overrides,
});

function createAdapterDependenciesWithMockGitHubCommand(execute, repository = 'owner/repository') {
  return productionDependencies(
    createTemporaryDirectory('sloop-infra-adapter-'),
    loadConfigText(canonicalConfigYaml()),
    repository,
    {
      execFileSync: execute,
    },
  );
}

test('remote claims publish string leases and manifest leases', () => {
  const calls = [];
  const events = [];
  const adapterDependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push(args);
    return '';
  });
  adapterDependencies.setRunLogger({ write: (type, data) => events.push({ type, data }) });

  adapterDependencies.remote.claim(81, 'key', 'lease');
  adapterDependencies.remote.claim(
    81,
    'key',
    createTestRunManifest({
      artifacts: ['existing'],

      lease: { owner: 'lease-owner', expiresAt: 7 },
    }),
  );

  assert.ok(calls.some((args) => args.includes('sloop/v1/lease/81/key/lease')));
  assert.ok(calls.some((args) => args.some((arg) => String(arg).includes('lease-owner/7'))));
  assert.ok(events.some((event) => event.type === 'github-response'));
});

test('remote snapshot rejects a repository identifier outside owner/repository form', () => {
  const marker = runManifestMarker(createTestRunManifest());
  const invalidRepo = createAdapterDependenciesWithMockGitHubCommand(
    () => JSON.stringify({ comments: [{ body: marker }] }),
    'invalid',
  );

  assert.throws(() => invalidRepo.remote.snapshot(81), /GitHub snapshot unavailable/);
});

test('production config reconciler delegates validated synchronization through its host seam', async () => {
  const dir = createTemporaryDirectory('sloop-infra-reconciler-');
  writeFileSync(join(dir, 'sloop.config.yaml'), canonicalConfigYaml());
  const calls = [];
  const reconciler = productionConfigReconciler(dir, (path, config) => {
    calls.push({ path, config });
  });
  await reconciler(dir, 'github');
  await reconciler(dir, 'skills');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.schemaVersion, 1);
  const failing = productionConfigReconciler(dir, () => {
    throw 'sync down';
  });
  await assert.rejects(() => failing(dir, 'github'), /github synchronization failed: sync down/);
});

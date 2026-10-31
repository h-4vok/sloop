import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml, loadConfigText } from '../../../src/config.js';
import { productionDependencies } from '../../../src/adapters.js';
import { runManifestMarker } from '../../../src/remote-state.js';

const config = loadConfigText(canonicalConfigYaml());

function createTemporaryRoot() {
  return createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-adapter-shapes-'));
}

function createAdapter(root, execFileSync) {
  return productionDependencies(root, config, 'owner/repo', { execFileSync });
}

function createPullRequestShapeAdapter(root, mode) {
  return createAdapter(root, (_file, args) => {
    if (args[0] !== 'pr') return JSON.stringify({});
    if (mode.value === 'empty') return JSON.stringify({});
    return JSON.stringify({
      number: 4,
      reviews: [{ commitId: 'id', submittedAt: 'date' }],
      comments: [{ body: 'comment', createdAt: 'date' }],
      statusCheckRollup: [{ context: 'context', state: 'PENDING' }],
    });
  });
}

test('production adapters normalize empty and alternate GitHub response shapes', () => {
  const mode = { value: 'empty' };
  const dependencies = createPullRequestShapeAdapter(createTemporaryRoot(), mode);
  const empty = dependencies.pullRequest(4);

  assert.deepEqual(empty.reviews, []);
  assert.deepEqual(empty.comments, []);
  assert.deepEqual(empty.statusCheckRollup, []);

  mode.value = 'alternate';

  const alternate = dependencies.pullRequest(4);
  assert.equal(alternate.reviews[0].commitId, 'id');
  assert.equal(alternate.statusCheckRollup[0].name, 'context');
});

test('production remote snapshot retains issue comment bodies', () => {
  const root = createTemporaryRoot();
  const manifest = createFallbackManifest();
  const dependencies = createAdapter(root, (_file, args) => {
    if (args[0] !== 'issue') return JSON.stringify({});
    return JSON.stringify({
      comments: [{ body: runManifestMarker(manifest) }],
    });
  });

  const snapshot = dependencies.remote.snapshot(4);

  assert.deepEqual(
    snapshot.comments.map(({ body }) => body),
    [runManifestMarker(manifest)],
  );
});

test('production remote adapter creates claim and publication comments', () => {
  const commands = [];
  const dependencies = createAdapter(createTemporaryRoot(), (_file, args) => {
    commands.push(args);
    return JSON.stringify({});
  });
  const manifest = createFallbackManifest();

  dependencies.remote.claim(4, 'claim-key', manifest);
  dependencies.remote.publish(4, manifest);

  const commentCommands = commands.filter((args) => args[0] === 'issue' && args[1] === 'comment');
  assert.equal(commentCommands.length, 2);
  assert.ok(commentCommands.every((args) => args.includes('--body')));
});

test('production remote adapter reports GitHub failures with operation context', () => {
  const dependencies = createAdapter(createTemporaryRoot(), () => {
    throw new Error('offline');
  });

  assert.throws(() => dependencies.remote.snapshot(4), /GitHub snapshot unavailable: offline/);
  assert.throws(
    () => dependencies.remote.reconcile(4, 'x'),
    /GitHub reconciliation unavailable: offline/,
  );
  assert.throws(() => dependencies.remote.claim(4, 'x', 'y'), /offline/);
  assert.throws(() => dependencies.remote.publish(4, createFallbackManifest()), /offline/);
});

function createFallbackManifest() {
  return {
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
}

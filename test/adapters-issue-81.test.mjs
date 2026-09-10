import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml, loadConfigText } from '../dist/config.js';
import { productionConfigReconciler, productionDependencies } from '../dist/adapters.js';
import { CliFailure } from '../dist/dispatcher.js';
import { runManifestMarker } from '../dist/remote-state.js';

function setup(execute) {
  const root = mkdtempSync(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

test('adapter wraps GitHub launch failures and reconciles published keys', () => {
  const calls = [];
  const dependencies = setup((_file, args) => {
    calls.push(args);
    if (args[0] === 'issue' && args.includes('--json'))
      return JSON.stringify({ comments: [{ body: 'artifact-key' }] });
    throw new Error('permission denied');
  });
  assert.throws(
    () => dependencies.comment(81, 'body'),
    (error) => {
      assert.ok(error instanceof CliFailure);
      assert.equal(error.exitCode, 5);
      return true;
    },
  );
  assert.equal(dependencies.remote.reconcile(81, 'artifact-key'), true);
  assert.ok(calls.some((args) => args[0] === 'issue' && args[1] === 'view'));
});

test('adapter rejects malformed snapshots and preserves GraphQL scope rules', () => {
  const dependencies = setup((_file, args) => {
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

test('adapter publishes manifests, cleans temporary PR bodies, and exposes lock recovery', () => {
  const calls = [];
  const dependencies = setup((_file, args) => {
    calls.push({
      args: [...args],
      body: args.includes('--body-file')
        ? readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
        : undefined,
    });
    return '';
  });
  const manifest = {
    protocol: 1,
    runId: 'run',
    issue: 81,
    branch: 'b',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'working',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [],
  };
  dependencies.remote.publish(81, manifest);
  dependencies.updatePullRequestBody(9, 'safe');
  assert.match(calls[0].args.join(' '), /issue comment 81/);
  assert.match(calls[0].args.join(' '), /sloop\/v1\/run\/run/);
  assert.equal(
    readdirSync(dependencies.root).some((name) => name.startsWith('.sloop-pr-')),
    false,
  );
  assert.equal(dependencies.tryAcquire({ pid: 1, createdAt: 1, token: 't' }), true);
  assert.equal(dependencies.tryAcquire({ pid: 2, createdAt: 2, token: 'u' }), false);
  dependencies.release('t');
});

test('production reconciler supports configured sync kinds and rejects unsupported kinds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-81-reconciler-'));
  const config = loadConfigText(canonicalConfigYaml());
  const reconciler = productionConfigReconciler(root);
  reconciler.preflight(root, 'github');
  reconciler.preflight(root, 'none');
  assert.throws(() => reconciler.preflight(root, 'unknown'), /No production reconciler/);
  await assert.rejects(() => reconciler(root, 'unknown'), /No production reconciler/);
  await assert.doesNotReject(() => reconciler(root, 'none'));
  assert.equal(config.schemaVersion, 1);
});

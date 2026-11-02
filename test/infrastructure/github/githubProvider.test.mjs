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

function createAdapterDependenciesWithMockGitHubCommand(execute) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-81-adapters-'));
  return productionDependencies(root, loadConfigText(canonicalConfigYaml()), 'o/r', {
    execFileSync: execute,
  });
}

test('adapter reports GitHub comment failures with a typed external-service error', () => {
  const dependencies = createAdapterDependenciesWithMockGitHubCommand(() => {
    throw new Error('permission denied');
  });
  const publishComment = () => dependencies.comment(81, 'body');

  assert.throws(publishComment, (error) => {
    assert.ok(error instanceof ExternalServiceError);
    assert.equal(error.service, 'github');
    assert.equal(error.message, 'permission denied');
    return true;
  });
});

test('adapter publishes a run manifest as an issue comment', () => {
  const calls = [];
  const dependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
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

  assert.match(calls[0].args.join(' '), /issue comment 81/);
  assert.match(calls[0].args.join(' '), /sloop\/v1\/run\/run/);
});

test('adapter removes its temporary pull-request body file after publication', () => {
  const calls = [];
  const dependencies = createAdapterDependenciesWithMockGitHubCommand((_file, args) => {
    calls.push({
      args: [...args],

      body: args.includes('--body-file')
        ? readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
        : undefined,
    });
    return '';
  });
  dependencies.updatePullRequestBody(9, 'safe');

  assert.equal(
    readdirSync(dependencies.root).some((name) => name.startsWith('.sloop-pr-')),
    false,
  );
  assert.equal(calls[0].body, 'safe');
});

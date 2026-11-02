import { test } from 'vitest';
import assert from 'node:assert/strict';
import { updateMetadata } from '../../src/release.js';
import {
  calculateRelease,
  publishRelease,
  reuseOrCreateRelease,
} from '../../scripts/release-workflow.mjs';

test('calculates a patch version from the linked issue title', async () => {
  const getReleaseMetadata = () => null;

  const patch = await calculateRelease({
    api: { closingIssueTitles: async () => ['[patch] fix'] },

    number: 113,

    body: '',

    tags: ['v0.2.0'],

    readTagMetadata: getReleaseMetadata,

    packageVersion: '0.2.0',
  });

  assert.deepEqual(patch, { kind: 'patch', version: '0.2.1', reused: false });
});

test('defaults to a minor version when no linked issue title resolves', async () => {
  const getReleaseMetadata = () => null;

  const fallback = await calculateRelease({
    api: { closingIssueTitles: async () => [], issueTitle: async () => null },

    number: 113,

    body: 'Closes #999',

    tags: ['v0.2.0'],

    readTagMetadata: getReleaseMetadata,

    packageVersion: '0.2.0',
  });

  assert.deepEqual(fallback, { kind: 'minor', version: '0.3.0', reused: false });
});

test('the same merged PR reuses its tagged version on a later run', async () => {
  const released = updateMetadata(
    '{"name":"sloop","version":"0.2.0"}\n',
    '# Changelog\n\nprevious\n',
    '0.2.1',
    '2026-10-01',
    113,
  );
  const result = await calculateRelease({
    api: { closingIssueTitles: async () => ['[patch] fix'] },

    number: 113,

    body: '',

    tags: ['v0.2.1', 'v0.2.0'],

    readTagMetadata: (tag) => (tag === 'v0.2.1' ? released : null),

    packageVersion: '0.2.1',
  });

  assert.deepEqual(result, { kind: 'patch', version: '0.2.1', reused: true });
});

test('existing release consistency is checked before any creation', async () => {
  let creations = 0;
  const api = {
    releaseByTag: async () => ({ tagName: 'v0.2.1', targetCommitish: 'wrong-target' }),

    createRelease: async () => {
      creations++;
    },
  };

  const reuseExistingRelease = reuseOrCreateRelease(api, 'v0.2.1', 'abc123');

  await assert.rejects(reuseExistingRelease, /does not match/);

  assert.equal(creations, 0);
});

test('publishing a second time reuses the tag without changing metadata', async () => {
  const calls = [];
  let hasTag = false;
  let hasRelease = false;
  const api = {
    releaseByTag: async () => (hasRelease ? { tagName: 'v0.2.1', targetCommitish: 'main' } : null),

    createRelease: async (tag) => {
      calls.push(['release', tag]);
      hasRelease = true;
    },
  };
  const gitCommand = (...args) => {
    calls.push(args);
    if (args[0] === 'rev-list') {
      if (!hasTag) throw new Error('no tag');
      return 'abc123';
    }
    if (args[0] === 'diff') throw new Error('staged changes');
    if (args[0] === 'tag') hasTag = true;
    return '';
  };
  const recordMetadataWrite = () => calls.push(['metadata']);
  const inputs = {
    api,

    version: '0.2.1',

    pr: 113,

    date: '2026-10-01',

    gitCommand,

    readFile: (file) => (file === 'package.json' ? '{"version":"0.2.0"}' : '# Changelog\n'),

    updateMetadata: recordMetadataWrite,
  };

  const first = await publishRelease(inputs);
  const countAfterFirst = calls.length;
  const second = await publishRelease(inputs);

  assert.equal(first, 'published');
  assert.equal(second, 'reused');
  assert.deepEqual(calls.slice(countAfterFirst), [['rev-list', '-n1', 'v0.2.1']]);
  assert.equal(calls.filter(([command]) => command === 'metadata').length, 1);
  assert.equal(calls.filter(([command]) => command === 'release').length, 1);
});

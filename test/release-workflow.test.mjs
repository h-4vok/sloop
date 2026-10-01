import test from 'node:test';
import assert from 'node:assert/strict';
import { updateMetadata } from '../src/release.js';
import {
  calculateRelease,
  closingIssueNumbers,
  createGitHubApi,
  publishRelease,
  resolveIssueTitles,
  reuseOrCreateRelease,
} from '../scripts/release-workflow.mjs';

test('extracts distinct Closes references from the PR body', () => {
  assert.deepEqual(
    closingIssueNumbers('Closes #112; close #113; CLOSES #112; fixes #114'),
    [112, 113],
  );
});

test('reads all linked issue titles from the GitHub GraphQL API', async () => {
  const cursors = [];
  const api = createGitHubApi({
    token: 'test-token',
    repository: 'owner/repo',
    fetchImpl: async (_url, options) => {
      const after = JSON.parse(options.body).variables.after;
      cursors.push(after);
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: [{ title: after ? '[major] break' : '[patch] fix' }],
                  pageInfo: { hasNextPage: !after, endCursor: after ? null : 'next' },
                },
              },
            },
          },
        }),
        { status: 200 },
      );
    },
  });

  const titles = await api.closingIssueTitles(113);

  assert.deepEqual(titles, ['[patch] fix', '[major] break']);
  assert.deepEqual(cursors, [null, 'next']);
});

test('falls back to PR body references when the linked list is unavailable', async () => {
  const lookedUp = [];
  const warnings = [];
  const api = {
    closingIssueTitles: async () => {
      throw new Error('unavailable');
    },
    issueTitle: async (number) => {
      lookedUp.push(number);
      if (number === 112) return '[patch] fix';
      throw new Error('HTTP 404');
    },
  };

  const titles = await resolveIssueTitles(api, 113, 'Closes #112\nCloses #999', (message) =>
    warnings.push(message),
  );

  assert.deepEqual(titles, ['[patch] fix']);
  assert.deepEqual(lookedUp, [112, 999]);
  assert.equal(warnings.length, 2);
});

test('calculates patch from issue #112 and minor only when no valid title resolves', async () => {
  const metadata = () => null;
  const patch = await calculateRelease({
    api: { closingIssueTitles: async () => ['[patch] fix'] },
    number: 113,
    body: '',
    tags: ['v0.2.0'],
    readTagMetadata: metadata,
    packageVersion: '0.2.0',
  });
  const fallback = await calculateRelease({
    api: { closingIssueTitles: async () => [], issueTitle: async () => null },
    number: 113,
    body: 'Closes #999',
    tags: ['v0.2.0'],
    readTagMetadata: metadata,
    packageVersion: '0.2.0',
  });

  assert.deepEqual(patch, { kind: 'patch', version: '0.2.1', reused: false });
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

  await assert.rejects(reuseOrCreateRelease(api, 'v0.2.1', 'abc123'), /does not match/);

  assert.equal(creations, 0);
});

test('publishing a second time reuses the tag without changing metadata', async () => {
  const calls = [];
  let tagExists = false;
  let releaseExists = false;
  const api = {
    releaseByTag: async () =>
      releaseExists ? { tagName: 'v0.2.1', targetCommitish: 'main' } : null,
    createRelease: async (tag) => {
      calls.push(['release', tag]);
      releaseExists = true;
    },
  };
  const gitCommand = (...args) => {
    calls.push(args);
    if (args[0] === 'rev-list') {
      if (!tagExists) throw new Error('no tag');
      return 'abc123';
    }
    if (args[0] === 'diff') throw new Error('staged changes');
    if (args[0] === 'tag') tagExists = true;
    return '';
  };
  const metadata = () => calls.push(['metadata']);
  const inputs = {
    api,
    version: '0.2.1',
    pr: 113,
    date: '2026-10-01',
    gitCommand,
    readFile: (file) => (file === 'package.json' ? '{"version":"0.2.0"}' : '# Changelog\n'),
    updateMetadata: metadata,
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

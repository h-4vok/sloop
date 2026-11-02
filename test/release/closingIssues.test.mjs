import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  closingIssueNumbers,
  createGitHubApi,
  resolveIssueTitles,
} from '../../scripts/release-workflow.mjs';

test('extracts distinct Closes references from the PR body', () => {
  const issueNumbers = closingIssueNumbers('Closes #112; close #113; CLOSES #112; fixes #114');

  assert.deepEqual(issueNumbers, [112, 113]);
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

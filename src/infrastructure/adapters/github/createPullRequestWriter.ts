import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { publicationBody } from '../../../publication.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';

type GitHubCommandClient = ReturnType<typeof gitHubCommandClientFactory.create>;

/** Publishes GitHub issue/PR comments and updates PR bodies through gh. */
export function createPullRequestWriter(client: GitHubCommandClient, root: string) {
  return {
    commentIssue(issue: number, body: unknown): void {
      client.run(['issue', 'comment', String(issue), '--body', publicationBody(body)], {
        stdio: 'inherit',
      });
    },

    commentPullRequest(pullRequest: number, body: unknown): void {
      client.run(['pr', 'comment', String(pullRequest), '--body', publicationBody(body)], {
        stdio: 'inherit',
      });
    },

    updatePullRequest(pullRequest: number, body: unknown): void {
      const temporaryBodyFile = join(root, `.sloop-pr-${process.pid}-${Date.now()}.md`);
      try {
        writeFileSync(temporaryBodyFile, publicationBody(body), 'utf8');
        client.run(['pr', 'edit', String(pullRequest), '--body-file', temporaryBodyFile], {
          stdio: 'inherit',
        });
      } finally {
        rmSync(temporaryBodyFile, { force: true });
      }
    },

    createIssue(title: string, body: string): number {
      const idempotencyKey = body.match(/Idempotency key:\s*(\S+)/)?.[1];
      if (idempotencyKey) {
        const existingIssues = client.runJson<{ number?: number; body?: string }[]>([
          'issue',
          'list',
          '--state',
          'all',
          '--search',
          idempotencyKey,
          '--json',
          'number,body',
          '--limit',
          '100',
        ]);
        const existingIssue = existingIssues.find((issue) => issue.body?.includes(idempotencyKey));
        if (existingIssue?.number) return existingIssue.number;
      }
      const result = client
        .run(['issue', 'create', '--title', title, '--body', publicationBody(body)], {
          stdio: 'pipe',
        })
        .trim();
      const issueNumber = result.match(/\/issues\/(\d+)(?:\D|$)/)?.[1];
      if (!issueNumber) throw new Error(`gh issue create returned no issue number: ${result}`);
      return Number(issueNumber);
    },
  };
}

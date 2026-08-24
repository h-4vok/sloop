import { execFileSync } from 'node:child_process';
import type { Deps } from './dispatcher.js';
import {
  checkoutWorkerBranch,
  commentPullRequest,
  defaultProcessAlive,
  eligible,
  prepareWorkerBranch,
  pullRequest,
  pullRequestBody,
  readState,
  runCommand,
  updatePullRequestBody,
  writeState,
} from './dispatcher.js';

/** Assemble concrete production adapters outside the dispatcher core. */
export function productionDependencies(root = process.cwd()): Deps {
  return {
    root,
    load: () => readState(),
    save: writeState,
    eligible,
    comment: (issue, body) => {
      execFileSync('gh', ['issue', 'comment', String(issue), '--body', body], {
        cwd: root,
        stdio: 'inherit',
      });
    },
    pullRequest,
    updatePullRequestBody,
    pullRequestBody,
    prComment: commentPullRequest,
    run: runCommand,
    prepareWorkerBranch: (issue) => prepareWorkerBranch(issue, root),
    checkoutWorkerBranch: (branch) => checkoutWorkerBranch(branch, root),
    pid: () => process.pid,
    processAlive: defaultProcessAlive,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onReclaim: () => {},
  };
}

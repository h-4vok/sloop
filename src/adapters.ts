import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockOwner } from './core/boundaries.js';
import type { Deps } from './dispatcher.js';
import {
  checkoutWorkerBranch,
  commentPullRequest,
  defaultProcessAlive,
  dispatcherLockPath,
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
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  const reclaim = join(lock, 'reclaiming');
  const writeOwner = (file: string, owner: LockOwner): void =>
    writeFileSync(file, JSON.stringify(owner, null, 2) + '\n');
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
    tryAcquire: (owner) => {
      mkdirSync(join(lock, '..'), { recursive: true });
      try {
        mkdirSync(lock);
        writeOwner(ownerFile, owner);
        return true;
      } catch {
        return false;
      }
    },
    readOwner: () => JSON.parse(readFileSync(ownerFile, 'utf8')) as LockOwner,
    tryBeginReclaim: (owner) => {
      try {
        mkdirSync(reclaim);
        writeOwner(join(reclaim, 'owner.json'), owner);
        return true;
      } catch {
        return false;
      }
    },
    readReclaimOwner: () =>
      JSON.parse(readFileSync(join(reclaim, 'owner.json'), 'utf8')) as LockOwner,
    reclaimAgeMs: (now) => now - statSync(reclaim).mtimeMs,
    finishReclaim: (owner) => {
      writeOwner(ownerFile, owner);
      rmSync(reclaim, { recursive: true, force: true });
    },
    abandonReclaim: () => rmSync(reclaim, { recursive: true, force: true }),
    release: (token) => {
      try {
        const owner = JSON.parse(readFileSync(ownerFile, 'utf8')) as LockOwner;
        if (owner.token === token) rmSync(lock, { recursive: true, force: true });
      } catch {
        /* lock already recovered */
      }
    },
  };
}

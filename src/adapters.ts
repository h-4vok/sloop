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
  linkIssueToActiveRun,
  prepareWorkerBranch,
  prepareRecovery,
  pullRequest,
  pullRequestBody,
  readState,
  recoverStaleLock,
  resetRunState,
  resolveReviewCap,
  runCommand,
  updatePullRequestBody,
  writeState,
} from './dispatcher.js';

/** Assemble concrete production adapters outside the dispatcher core. */
export function productionDependencies(root = process.cwd()): Deps {
  const state = join(root, '.sloop', 'state.json');
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  const reclaim = join(lock, 'reclaiming');
  const writeOwner = (file: string, owner: LockOwner): void =>
    writeFileSync(file, JSON.stringify(owner, null, 2) + '\n');
  return {
    root,
    load: () => readState(state),
    save: (next) => writeState(next, state),
    loadConfig: () => {
      const file = join(root, 'sloop.config.json');
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
      }
    },
    status: (verbose) => {
      const current = readState(state);
      return verbose
        ? current
        : {
            issue: current.issue,
            pr: current.pr,
            status: current.status,
            lastError: current.lastError,
          };
    },
    list: () => eligible().map(({ number, title }) => ({ number, title })),
    recoverLock: () => recoverStaleLock(root, defaultProcessAlive),
    reset: () => writeState(resetRunState(readState(state), defaultProcessAlive), state),
    resolveReviewCap: (args, config) => resolveReviewCap(args, config),
    linkIssue: (issue) => linkIssueToActiveRun(issue),
    prepareRecovery: (issue, requestedPr, config) => {
      const current = readState(state);
      const pr = requestedPr ?? current.pr;
      if (!Number.isInteger(issue) || issue < 1)
        throw new Error('--prepare-recovery requires an issue number');
      if (!pr || !Number.isInteger(pr))
        throw new Error('--prepare-recovery requires --pr or an existing state.pr');
      writeState(
        prepareRecovery(current, issue, pr, Date.now(), config.workerLeaseMs ?? 900000),
        state,
      );
      return pr;
    },
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

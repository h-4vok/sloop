import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockOwner } from './core/boundaries.js';
import type { Deps } from './dispatcher.js';
import type { SloopConfig } from './config.js';
import { CliFailure } from './dispatcher.js';
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
function dispatcherConfig(config: SloopConfig): import('./dispatcher.js').Config {
  const runner = (value: SloopConfig['agents']['worker']) => ({
    command: value.argv[0],
    args: [...value.argv.slice(1)],
    timeoutMs: value.timeout,
    retries: value.retries,
  });
  return {
    baseBranch: config.repository.baseBranch,
    workerCommand: runner(config.agents.worker),
    qaCommand: runner(config.agents.qa),
    staffReviewCommand: runner(config.agents.staff),
    requiredPrChecks: [...config.workflow.requiredChecks],
    workerLeaseMs: config.agents.worker.timeout,
    maxReviewRounds: config.arbiter.reviewRounds,
    logRoleInvocation: config.logging.roleInvocation,
    lockTtlMs: config.agents.worker.timeout,
  };
}

export function productionDependencies(
  root: string,
  validatedConfig: SloopConfig,
  repository: string,
): Deps {
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
    loadConfig: () => dispatcherConfig(validatedConfig),
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
    list: () => {
      try {
        return eligible(root, repository, validatedConfig.github.labels.eligible).map(
          ({ number, title }) => ({ number, title }),
        );
      } catch (error) {
        throw new CliFailure(5, error instanceof Error ? error.message : String(error));
      }
    },
    recoverLock: () => recoverStaleLock(root, defaultProcessAlive),
    reset: () => writeState(resetRunState(readState(state), defaultProcessAlive), state),
    resolveReviewCap: (args, config) => resolveReviewCap(args, config, state, root, repository),
    linkIssue: (issue) => linkIssueToActiveRun(issue, state, root, repository),
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
    eligible: () => {
      try {
        return eligible(root, repository, validatedConfig.github.labels.eligible);
      } catch (error) {
        throw new CliFailure(5, error instanceof Error ? error.message : String(error));
      }
    },
    comment: (issue, body) => {
      try {
        execFileSync(
          'gh',
          ['issue', 'comment', String(issue), '--repo', repository, '--body', body],
          {
            cwd: root,
            stdio: 'inherit',
          },
        );
      } catch (error) {
        throw new CliFailure(5, error instanceof Error ? error.message : String(error));
      }
    },
    pullRequest: (pr) => pullRequest(pr, root, repository),
    updatePullRequestBody: (pr, body) => updatePullRequestBody(pr, body, root, repository),
    pullRequestBody: (pr) => pullRequestBody(pr, root, repository),
    prComment: (pr, body) => commentPullRequest(pr, body, root, repository),
    run: (spec) => runCommand(spec, root),
    prepareWorkerBranch: (issue) =>
      prepareWorkerBranch(
        issue,
        root,
        validatedConfig.repository.remote,
        validatedConfig.repository.baseBranch,
      ),
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

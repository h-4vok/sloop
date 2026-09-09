import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockOwner, WorkspaceAdapter } from './core/boundaries.js';
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
import type { ConfigReconciler } from './config-wizard.js';
import {
  clearWorkspaces,
  cleanupWorkspace,
  listWorkspaces,
  prepareCheckoutWorkspace,
  prepareWorktreeWorkspace,
  recoverWorkspace,
} from './workspace.js';

/**
 * Production seam for the reconciliation interfaces owned by the runtime.
 * There are no concrete skill/scheduler/workspace integrations in this
 * checkout yet, so production must fail closed instead of claiming that a
 * requested external operation completed. The wizard invokes this only after
 * validation, confirmation, and atomic replacement of the YAML document.
 */
export function productionConfigReconciler(_root: string): ConfigReconciler {
  const reconciler = (async (
    _rootPath: string,
    kind: NonNullable<Parameters<ConfigReconciler>[1]>,
  ) => {
    if (!kind || kind === 'none') return;
    throw new Error(
      `No production reconciler is available for ${kind}; use --no-sync or install the ${kind} integration.`,
    );
  }) as ConfigReconciler & {
    preflight: (root: string, kind: NonNullable<Parameters<ConfigReconciler>[1]>) => void;
  };
  reconciler.preflight = (_rootPath, kind) => {
    if (kind && kind !== 'none')
      throw new Error(
        `No production reconciler is available for ${kind}; use --no-sync or install the ${kind} integration.`,
      );
  };
  return reconciler;
}

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
  let executionRoot = root;
  const workspaceAdapter: WorkspaceAdapter = {
    mode: validatedConfig.workspace.mode,
    prepare: (issue) => {
      const options = {
        repositoryRoot: root,
        remote: validatedConfig.repository.remote,
        baseBranch: validatedConfig.repository.baseBranch,
        branchPrefix: validatedConfig.repository.branchPrefix ?? 'codex/issue-',
        issue,
        runId: readState(state).workerRunId ?? 'dispatcher',
        worktreeRoot: validatedConfig.workspace.worktreeRoot,
        mode: validatedConfig.workspace.mode,
        stateFile: state,
      };
      const facts =
        validatedConfig.workspace.mode === 'worktree'
          ? prepareWorktreeWorkspace(options)
          : prepareCheckoutWorkspace(options);
      executionRoot = facts.executionRoot;
      return facts;
    },
    recover: (issue, runId) =>
      recoverWorkspace({
        repositoryRoot: root,
        remote: validatedConfig.repository.remote,
        baseBranch: validatedConfig.repository.baseBranch,
        branchPrefix: validatedConfig.repository.branchPrefix ?? 'codex/issue-',
        issue,
        runId,
        worktreeRoot: validatedConfig.workspace.worktreeRoot,
        mode: validatedConfig.workspace.mode,
        stateFile: state,
      }),
    cleanup: (facts) => {
      if (validatedConfig.workspace.mode === 'worktree') cleanupWorkspace(facts, root, state);
      executionRoot = root;
    },
  };
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
    workspaceAdapter,
    run: (spec) => runCommand(spec, executionRoot),
    prepareWorkerBranch: (issue) =>
      prepareWorkerBranch(
        issue,
        root,
        validatedConfig.repository.remote,
        validatedConfig.repository.baseBranch,
        validatedConfig.repository.branchPrefix,
      ),
    checkoutWorkerBranch: (branch) => checkoutWorkerBranch(branch, root),
    listAllWorktrees: () => listWorkspaces(root, state),
    clearAllWorktrees: () => clearWorkspaces(root, state),
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

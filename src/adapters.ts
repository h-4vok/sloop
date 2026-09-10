import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockOwner, RunContext, RunEventLogger, WorkspaceAdapter } from './core/boundaries.js';
import type { Deps } from './dispatcher.js';
import type { SloopConfig } from './config.js';
import { CliFailure } from './dispatcher.js';
import {
  checkoutWorkerBranch,
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
import { loadConfigText } from './config.js';
import { syncPrerequisites } from './sync.js';
import { publicationBody } from './publication.js';
import { artifactKey, parseRunManifestMarker, runManifestMarker } from './remote-state.js';
import type { RunManifest } from './remote-state.js';

type AdapterExecOptions = {
  cwd: string;
  encoding?: BufferEncoding;
  stdio?: 'inherit';
};
type AdapterExec = (
  file: string,
  args: string[],
  options: AdapterExecOptions,
) => string | Buffer | void;

const nativeAdapterExec: AdapterExec = (file, args, options) => execFileSync(file, args, options);

export type ProductionAdapterOptions = Readonly<{
  execFileSync?: AdapterExec;
}>;

function adapterGh(
  execute: AdapterExec,
  args: string[],
  root: string,
  repository: string,
  options: Omit<AdapterExecOptions, 'cwd'> = {},
): string {
  try {
    // `gh api` has no `--repo` flag. API requests must scope themselves through
    // their endpoint or request fields (the GraphQL caller supplies owner/name).
    const scopedArgs = args[0] === 'api' ? args : [...args, '--repo', repository];
    return String(execute('gh', scopedArgs, { ...options, cwd: root }) ?? '');
  } catch (error) {
    throw new CliFailure(5, error instanceof Error ? error.message : String(error));
  }
}

function publishGhBody(
  execute: AdapterExec,
  args: string[],
  body: unknown,
  root: string,
  repository: string,
): void {
  adapterGh(execute, [...args, '--body', publicationBody(body)], root, repository, {
    stdio: 'inherit',
  });
}

function publishPullRequestBody(
  execute: AdapterExec,
  pr: number,
  body: unknown,
  root: string,
  repository: string,
): void {
  const temp = join(root, `.sloop-pr-${process.pid}-${Date.now()}.md`);
  try {
    writeFileSync(temp, publicationBody(body), 'utf8');
    adapterGh(execute, ['pr', 'edit', String(pr), '--body-file', temp], root, repository, {
      stdio: 'inherit',
    });
  } finally {
    rmSync(temp, { force: true });
  }
}

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
    if (kind === 'github' || kind === 'skills') {
      try {
        syncPrerequisites(
          _rootPath,
          loadConfigText(readFileSync(join(_rootPath, 'sloop.config.yaml'), 'utf8')),
        );
      } catch (error) {
        throw new Error(
          `${kind} synchronization failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    throw new Error(`No production reconciler is available for ${kind}.`);
  }) as ConfigReconciler & {
    preflight: (root: string, kind: NonNullable<Parameters<ConfigReconciler>[1]>) => void;
  };
  reconciler.preflight = (_rootPath, kind) => {
    if (kind && !['none', 'github', 'skills'].includes(kind))
      throw new Error(`No production reconciler is available for ${kind}.`);
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
    loggingRetentionMs: config.logging.retention,
    lockTtlMs: config.agents.worker.timeout,
  };
}

export function productionDependencies(
  root: string,
  validatedConfig: SloopConfig,
  repository: string,
  options: ProductionAdapterOptions = {},
): Deps {
  const execute = options.execFileSync ?? nativeAdapterExec;
  const state = join(root, '.sloop', 'state.json');
  let executionRoot = root;
  let runLogger: RunEventLogger | undefined;
  const logGithub = (phase: string, operation: string, data: unknown): void => {
    runLogger?.write(`github-${phase}`, { operation, data });
  };
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
    recover: (issue, runId, branch) => {
      const facts = recoverWorkspace({
        repositoryRoot: root,
        remote: validatedConfig.repository.remote,
        baseBranch: validatedConfig.repository.baseBranch,
        branchPrefix: validatedConfig.repository.branchPrefix ?? 'codex/issue-',
        issue,
        runId,
        branch,
        worktreeRoot: validatedConfig.workspace.worktreeRoot,
        mode: validatedConfig.workspace.mode,
        stateFile: state,
      });
      executionRoot = facts?.executionRoot ?? root;
      return facts;
    },
    cleanup: (facts) => {
      if (validatedConfig.workspace.mode === 'worktree') cleanupWorkspace(facts, root, state);
      executionRoot = root;
    },
    context: (): RunContext => ({ originalRepository: root, executionRoot }),
  };
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  const reclaim = join(lock, 'reclaiming');
  const writeOwner = (file: string, owner: LockOwner): void =>
    writeFileSync(file, JSON.stringify(owner, null, 2) + '\n');
  return {
    root,
    remoteRequired: true,
    setRunLogger: (logger) => {
      runLogger = logger;
    },
    runContext: () => ({ originalRepository: root, executionRoot }),
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
        const result = eligible(root, repository, validatedConfig.github.labels.eligible);
        logGithub('response', 'eligible', result);
        return result;
      } catch (error) {
        logGithub('error', 'eligible', error instanceof Error ? error.message : String(error));
        throw new CliFailure(5, error instanceof Error ? error.message : String(error));
      }
    },
    comment: (issue, body) => {
      try {
        logGithub('request', 'issue.comment', { issue, body });
        publishGhBody(execute, ['issue', 'comment', String(issue)], body, root, repository);
        logGithub('response', 'issue.comment', { issue });
      } catch (error) {
        logGithub('error', 'issue.comment', error instanceof Error ? error.message : String(error));
        throw new CliFailure(5, error instanceof Error ? error.message : String(error));
      }
    },
    pullRequest: (pr) => {
      logGithub('request', 'pullRequest', { pr });
      try {
        const result = pullRequest(pr, root, repository);
        logGithub('response', 'pullRequest', result);
        return result;
      } catch (error) {
        logGithub('error', 'pullRequest', error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    updatePullRequestBody: (pr, body) => {
      logGithub('request', 'updatePullRequestBody', { pr, body });
      try {
        publishPullRequestBody(execute, pr, body, root, repository);
        logGithub('response', 'updatePullRequestBody', { pr });
      } catch (error) {
        logGithub(
          'error',
          'updatePullRequestBody',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    pullRequestBody: (pr) => {
      logGithub('request', 'pullRequestBody', { pr });
      try {
        const result = pullRequestBody(pr, root, repository);
        logGithub('response', 'pullRequestBody', result);
        return result;
      } catch (error) {
        logGithub(
          'error',
          'pullRequestBody',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
    prComment: (pr, body) => {
      logGithub('request', 'prComment', { pr, body });
      try {
        publishGhBody(execute, ['pr', 'comment', String(pr)], body, root, repository);
        logGithub('response', 'prComment', { pr });
      } catch (error) {
        logGithub('error', 'prComment', error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
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
    remote: {
      snapshot: (issue) => {
        try {
          logGithub('request', 'remote.snapshot', { issue });
          const raw = adapterGh(
            execute,
            ['issue', 'view', String(issue), '--json', 'labels,comments'],
            root,
            repository,
          );
          const value = JSON.parse(raw) as {
            labels?: { name: string }[];
            comments?: { body: string }[];
          };
          const comments = value.comments ?? [];
          const issueManifests = comments
            .map((comment) => parseRunManifestMarker(comment.body, issue))
            .filter((manifest): manifest is RunManifest => Boolean(manifest));
          const manifest = issueManifests.at(-1);
          let prData: {
            number?: number;
            headRefName?: string;
            headRefOid?: string;
            comments?: { body: string }[];
            reviews?: { state: string }[];
            statusCheckRollup?: { name: string; status: string; conclusion?: string }[];
          } = {};
          let inlineThreads: { resolved: boolean }[] = [];
          if (manifest?.pr) {
            const prRaw = adapterGh(
              execute,
              [
                'pr',
                'view',
                String(manifest.pr),
                '--json',
                'number,headRefName,headRefOid,comments,reviews,statusCheckRollup',
              ],
              root,
              repository,
            );
            prData = JSON.parse(prRaw) as typeof prData;
            const [owner, name] = repository.split('/', 2);
            if (!owner || !name) throw new Error('configured GitHub repository must be owner/name');
            const threadRaw = adapterGh(
              execute,
              [
                'api',
                'graphql',
                '-f',
                'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}',
                '-f',
                `owner=${owner}`,
                '-f',
                `name=${name}`,
                '-F',
                `number=${manifest.pr}`,
              ],
              root,
              repository,
            );
            inlineThreads =
              JSON.parse(threadRaw).data?.repository?.pullRequest?.reviewThreads?.nodes?.map(
                (thread: { isResolved: boolean }) => ({ resolved: thread.isResolved }),
              ) ?? [];
          }
          const allComments = [...comments, ...(prData.comments ?? [])];
          const allManifests = allComments
            .map((comment) => parseRunManifestMarker(comment.body, issue))
            .filter((candidate): candidate is RunManifest => Boolean(candidate));
          const selected = allManifests.at(-1) ?? manifest;
          const markers = allComments.flatMap((comment) =>
            [...comment.body.matchAll(/(?:sloop\/v1\/[^\s`]+|sloop-v1\/[^\s`]+)/g)].map(
              (m) => m[0],
            ),
          );
          const result = {
            issue,
            labels: (value.labels ?? []).map((label) => label.name),
            pr: prData.number ?? selected?.pr,
            comments: allComments.map((comment) => ({ body: comment.body })),
            markers,
            manifest: selected,
            branch: prData.headRefName ?? selected?.branch,
            sha: prData.headRefOid,
            checks: prData.statusCheckRollup,
            reviews: prData.reviews,
            inlineThreads,
            now: Date.now(),
            leaseOwner: `${process.pid}:${issue}`,
          };
          logGithub('response', 'remote.snapshot', result);
          return result;
        } catch (error) {
          logGithub(
            'error',
            'remote.snapshot',
            error instanceof Error ? error.message : String(error),
          );
          throw new CliFailure(
            5,
            `GitHub snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      reconcile: (issue, key) => {
        try {
          logGithub('request', 'remote.reconcile', { issue, key });
          const raw = adapterGh(
            execute,
            ['issue', 'view', String(issue), '--json', 'comments'],
            root,
            repository,
          );
          const result =
            JSON.parse(raw).comments?.some((comment: { body: string }) =>
              comment.body.includes(key),
            ) ?? false;
          logGithub('response', 'remote.reconcile', { issue, key, found: result });
          return result;
        } catch (error) {
          logGithub(
            'error',
            'remote.reconcile',
            error instanceof Error ? error.message : String(error),
          );
          throw new CliFailure(
            5,
            `GitHub reconciliation unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      claim: (issue, key, manifest) => {
        const body =
          typeof manifest === 'string'
            ? `sloop/v1/lease/${issue}/${key}/${manifest}`
            : `${runManifestMarker({
                ...manifest,
                artifacts: [...new Set([...(manifest.artifacts ?? []), key])],
              })}\nsloop/v1/run/${manifest.runId}\n${key}\nsloop/v1/lease/${issue}/${manifest.lease?.owner ?? key}/${manifest.lease?.expiresAt ?? ''}`;
        try {
          logGithub('request', 'remote.claim', { issue, key, manifest });
          publishGhBody(execute, ['issue', 'comment', String(issue)], body, root, repository);
          logGithub('response', 'remote.claim', { issue, key });
        } catch (error) {
          logGithub(
            'error',
            'remote.claim',
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      },
      publish: (issue, manifest) => {
        const key = manifest.artifacts[0] ?? artifactKey('run', { issue, runId: manifest.runId });
        const body = `${runManifestMarker(manifest)}\nsloop/v1/run/${manifest.runId}\n${key}`;
        try {
          logGithub('request', 'remote.publish', { issue, key, manifest });
          publishGhBody(execute, ['issue', 'comment', String(issue)], body, root, repository);
          logGithub('response', 'remote.publish', { issue, key });
        } catch (error) {
          logGithub(
            'error',
            'remote.publish',
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      },
    },
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

import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import {
  acquire,
  childProcessInvocation,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  dispatch,
  eligible,
  linkIssueToActiveRun,
  pullRequest,
  pullRequestBody,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  redactDiagnostic,
  readState,
  reviewFeedback,
  workerBranchName,
  withIssueClosingReference,
  resetRunState,
  runCommand,
  hasCommit,
  runDispatcherCli,
  updatePullRequestBody,
  commentPullRequest,
  writeState,
  maxRoundsForUserBudget,
  selectIssues,
} from '../../src/dispatcher.js';
import { parseDispatcherCommand as parseDispatcherCommandResult } from '../../src/runtime.js';
import { issueLabelNames } from '../../src/issue-selection.js';
import { artifactKey, runManifestMarker } from '../../src/remote-state.js';

const parseDispatcherCommand = (args) => {
  const parseResult = parseDispatcherCommandResult(args);
  if (parseResult.ok) return parseResult.value;
  throw new Error(parseResult.error);
};

function createMockGitHubHost(respond) {
  const calls = [];
  return {
    calls,

    host: {
      platform: 'linux',

      pid: () => 123,

      now: () => 1_700_000_000_000,

      resolveExecutable: () => 'gh',

      runSyncCommand: (_command, args, _input, _platform, _comSpec, cwd) => {
        calls.push({ args, cwd });
        return respond(args, cwd);
      },
    },
  };
}

const baseConfig = {
  baseBranch: 'main',

  workerCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },

  staffReviewCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },

  qaCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },

  requiredPrChecks: ['pr-checks'],

  checkPollIntervalMs: 0,

  checkTimeoutMs: 1000,

  evidencePollIntervalMs: 0,

  evidenceTimeoutMs: 1000,

  workerLeaseMs: 100,

  maxReviewRounds: 5,
};

function createExistingHumanReviewGuide(commit = 'abc1') {
  return `[Human Review Guide] round=1 commit=${commit}\n<!-- sloop-dispatcher-human-review-guide -->\n\nSummary\nExercise the CLI change.\n\nSteps\n1. Run the focused command in a temporary directory.\n\nExpected results\n- The documented output appears.\n\nIsolation\nUse a temporary checkout and no credentials.\n\nLimitations / diagnostics\n- A failed command indicates the change is not ready.\n\nApproval checklist\n- [ ] Behavior matches the acceptance criteria.`;
}

function createMockDispatcherHarness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-'));
  let state = overrides.initialState ?? {};
  const saves = [];
  const comments = [];
  const runs = [];
  const prBodyUpdates = [];
  const createdPrBodies = [];
  const createdIssues = [];
  const reviews = [];
  let activeLogger;
  const pr = {
    number: overrides.prNumber ?? 14,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: overrides.headRefName ?? 'codex/issue-1',

    headRefOid: 'abc0',

    body: overrides.prBody ?? 'Summary',

    mergeStateStatus: 'CLEAN',

    mergeable: 'MERGEABLE',

    comments: [],

    reviews,

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  let workerCount = 0;
  let qaCount = 0;
  let staffCount = 0;
  const qaVerdicts = overrides.qaVerdicts ?? ['passed'];
  const staffVerdicts = overrides.staffVerdicts ?? ['approved'];
  const qaBodies = overrides.qaBodies;
  const staffBodies = overrides.staffBodies;
  const publishEvidence = {
    worker: true,

    qa: true,

    staff: true,

    ...(overrides.publishEvidence ?? {}),
  };
  const humanVerification = overrides.humanVerification ?? true;
  for (let guide = 0; guide < (overrides.existingHumanGuides ?? 0); guide += 1)
    pr.comments.push({ body: createExistingHumanReviewGuide() });
  if (overrides.malformedHumanGuide)
    pr.comments.push({
      body: '[Human Review Guide] round=1 commit=abc1\n<!-- sloop-dispatcher-human-review-guide -->',
    });
  const checkSequences = overrides.checkSequences ?? [pr.statusCheckRollup];
  let checkIndex = 0;

  const getAgentRole = (spec) => {
    if (spec.input?.includes('Use the worker skill')) return 'worker';
    if (spec.input?.includes('Use the sloop-qa skill')) return 'qa';
    if (spec.input?.includes('Use the staff-reviewer skill')) return 'staff';
    if (spec.input?.includes('Use the Arbiter contract')) return 'arbiter';
    return 'unknown';
  };

  const dependencies = {
    root,

    load: () => state,

    save: (next) => {
      saves.push(structuredClone(next));
      state = next;
    },

    loadConfig: () => ({ ...baseConfig, ...overrides.config }),

    setRunLogger: (logger) => {
      activeLogger = logger;
    },

    runContext: () => ({ originalRepository: root, executionRoot: root }),

    status: (verbose) =>
      verbose
        ? state
        : { issue: state.issue, pr: state.pr, status: state.status, lastError: state.lastError },

    list: () => issues.map(({ number, title }) => ({ number, title })),

    recoverLock: () => 'recovered',

    reset: () => {
      state = resetRunState(state, () => false);
    },

    resolveReviewCap: () => {},

    linkIssue: () => {},

    prepareRecovery: (issue, requestedPr) => {
      const number = requestedPr ?? state.pr;
      state = prepareRecovery(state, issue, number, Date.now(), 100);
      return number;
    },

    eligible: () => issues,

    comment: (issue, body) => comments.push([issue, body]),

    run: async (spec) => {
      runs.push(spec);
      const role = getAgentRole(spec);
      spec.onStdout?.(`${role} stdout ✓\nline two\n`);
      spec.onStderr?.(`${role} stderr\nline err\n`);
      const round = Number(spec.input?.match(/review round (\d+)/)?.[1] ?? 1);
      if (role === 'worker') {
        workerCount += 1;
        pr.headRefOid = `abc${workerCount}`;
        if (overrides.workerCreatesPr) {
          // Model the Worker passing the dispatcher-owned payload directly to
          // `gh pr create --body-file`; this is the initial remote PR body.
          pr.body = spec.env.SLOOP_PR_BODY;
          createdPrBodies.push(pr.body);
        }
        spec.onStart?.(1000 + workerCount);
        spec.onHeartbeat?.();
        if (publishEvidence.worker) {
          const verification = humanVerification
            ? '\n\n[Human Verification]\n1. Run the focused command in a temporary directory.\n2. Confirm the documented output appears.'
            : '';
          pr.comments.push({
            body: `[Worker] round=${round} status=ready_for_review pr=${pr.number} base=main commit=${pr.headRefOid}${verification}`,

            createdAt: `${workerCount}`,
          });
        }
        return `WORKER_RESULT pr=${pr.number} base=main`;
      }
      if (role === 'qa') {
        qaCount += 1;
        const verdict = qaVerdicts[qaCount - 1] ?? qaVerdicts.at(-1);
        if (publishEvidence.qa)
          (overrides.qaPublication === 'review' ? reviews : pr.comments).push({
            body:
              qaBodies?.[qaCount - 1] ??
              `[QA/SDET Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,

            commitId: pr.headRefOid,

            submittedAt: `${qaCount}`,

            createdAt: `${qaCount}`,
          });
        return 'QA completed';
      }
      if (role === 'staff') {
        staffCount += 1;
        const verdict = staffVerdicts[staffCount - 1] ?? staffVerdicts.at(-1);
        if (publishEvidence.staff)
          reviews.push({
            body:
              staffBodies?.[staffCount - 1] ??
              `[Staff Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,

            commitId: pr.headRefOid,

            submittedAt: `${staffCount}`,
          });
        return 'Staff completed';
      }
      if (role === 'arbiter') {
        const record = JSON.parse(spec.input.split('Record:\n')[1]);
        return JSON.stringify({
          schema: 'sloop.agent-output/v1',

          context: {
            run: record.state.workerRunId ?? `arbiter-${record.round}`,

            issue: record.issue.number,

            pr: record.pr.number,

            round: record.round,

            sha: record.pr.headRefOid ?? 'unknown',

            cursor: `arbiter-${record.round}`,
          },

          producer: 'arbiter',

          status: overrides.arbiterAction ?? 'uphold',

          payload: {
            rationale: 'Conflict analysis against the contract justifies this decision.',

            references: ['QA feedback'],

            decisions: [
              {
                findingId: overrides.arbiterFindingId ?? 'Q1',

                owner: 'qa',

                action: overrides.arbiterAction ?? 'uphold',

                rationale:
                  'Conflict between the review arguments; analysis against contract, product and UX justifies this decision.',

                direction: 'Apply the requested correction.',

                verification: 'Run the repository gate and repeat QA.',

                ...(overrides.arbiterAction === 'defer'
                  ? {
                      followUp: {
                        title: 'Deferred Arbiter follow-up',

                        acceptance: 'The deferred finding is implemented and verified.',

                        context: 'Relevant review context and source evidence.',
                      },
                    }
                  : {}),
              },
            ],
          },
        });
      }
      return 'completed';
    },

    pullRequest: () => {
      pr.statusCheckRollup = checkSequences[Math.min(checkIndex++, checkSequences.length - 1)];
      return structuredClone(pr);
    },

    updatePullRequestBody: async (number, body) => {
      assert.equal(number, pr.number);
      pr.body = body;
      prBodyUpdates.push({ number, body });
    },

    pullRequestBody: () => pr.body,

    prComment: (number, body) => {
      assert.equal(number, pr.number);
      pr.comments.push({ body });
    },

    createIssue: (title, body) => {
      createdIssues.push({ title, body });
      return 99;
    },

    now: () => Date.now(),

    pid: () => process.pid,

    processAlive: (pid) => pid > 0 && pid !== -1,

    sleep: async () => {},

    onReclaim: () => {},

    tryAcquire: () => true,

    readOwner: () => {
      throw new Error('lock owner unavailable');
    },

    tryBeginReclaim: () => true,

    readReclaimOwner: () => {
      throw new Error('reclaim owner unavailable');
    },

    reclaimAgeMs: () => 0,

    finishReclaim: () => {},

    abandonReclaim: () => {},

    release: () => {},

    prepareWorkerBranch: (issue) => ({
      branch: workerBranchName(issue),

      mainBaseSha: 'main-sha-1',
    }),

    checkoutWorkerBranch: () => {},
  };

  return {
    root,

    pr,

    comments,

    runs,

    reviews,

    saves,

    dependencies,

    state: () => state,

    setState: (next) => {
      state = next;
    },

    counts: () => ({ workerCount, qaCount, staffCount }),

    prBodyUpdates,

    createdPrBodies,

    createdIssues,

    cfg: { ...baseConfig, ...overrides.config },
  };
}

function createQaCommentResponse() {
  const head = '43bc61cc0c7b0476f668a6e4f3a920386497f329';
  return {
    number: 109,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-100-6224',

    headRefOid: head,

    body: 'Closes #100',

    mergeStateStatus: 'CLEAN',

    mergeable: 'MERGEABLE',

    reviews: [
      {
        body: '[QA/SDET Review] round=1 verdict=changes_requested',

        commit: { oid: '58787024de7f99884f00d57480bc76edf66cb2a1' },

        submittedAt: '2026-09-30T16:24:27Z',
      },
      {
        body: '[QA/SDET Review] round=2 verdict=changes_requested',

        commit: { oid: '497a24db1037c4a1da331b18d4ef0922a29031a7' },

        submittedAt: '2026-09-30T16:33:03Z',
      },
    ],

    comments: [
      {
        body: `[Worker] round=2 status=ready_for_review pr=109 base=main commit=${head}\n\n[Human Verification]\n1. Load configuration with an unknown key.\n2. Confirm it warns and loads successfully.`,

        createdAt: '2026-10-01T08:47:27Z',
      },
      {
        body: `[QA/SDET Review] round=2 verdict=passed\n\ncommit=${head}\n\n- [Q1] pass - Unknown keys warn and are ignored.`,

        createdAt: '2026-10-01T08:48:42Z',
      },
    ],

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
}

function assertPersistedDiagnostic(state, phase, diagnostic, context) {
  assert.ok((state.lastError.match(/[.!?]+/g) ?? []).length <= 4, state.lastError);
  assert.match(state.lastError, new RegExp(`during ${phase}`));
  for (const value of context) assert.match(state.lastError, value);
  assert.equal(state.lastErrorVerbose, diagnostic);
}

export {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  vi,
  acquire,
  childProcessInvocation,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  dispatch,
  eligible,
  linkIssueToActiveRun,
  pullRequest,
  pullRequestBody,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  redactDiagnostic,
  readState,
  reviewFeedback,
  workerBranchName,
  withIssueClosingReference,
  resetRunState,
  runCommand,
  hasCommit,
  runDispatcherCli,
  updatePullRequestBody,
  commentPullRequest,
  writeState,
  maxRoundsForUserBudget,
  selectIssues,
  parseDispatcherCommandResult,
  issueLabelNames,
  artifactKey,
  runManifestMarker,
  parseDispatcherCommand,
  createMockGitHubHost,
  baseConfig,
  createExistingHumanReviewGuide,
  createMockDispatcherHarness,
  createQaCommentResponse,
  assertPersistedDiagnostic,
};

import assert from 'node:assert/strict';
import { prepareRecovery, resetRunState, workerBranchName } from '../../../src/dispatcher.js';
import { baseConfig } from './dispatcher-fixture-config.mjs';
import { createMockAgentRun } from './createMockAgentRun.mjs';

export function createMockDispatcherDependencies(fixture) {
  return {
    root: fixture.root,
    load: () => fixture.state,
    save: (next) => {
      fixture.saves.push(structuredClone(next));
      fixture.state = next;
    },
    loadConfig: () => ({ ...baseConfig, ...fixture.overrides.config }),
    setRunLogger: (logger) => {
      fixture.activeLogger = logger;
    },
    runContext: () => ({ originalRepository: fixture.root, executionRoot: fixture.root }),
    status: (verbose) =>
      verbose
        ? fixture.state
        : {
            issue: fixture.state.issue,
            pr: fixture.state.pr,
            status: fixture.state.status,
            lastError: fixture.state.lastError,
          },
    list: () => fixture.issues.map(({ number, title }) => ({ number, title })),
    recoverLock: () => 'recovered',
    reset: () => {
      fixture.state = resetRunState(fixture.state, () => false);
    },
    resolveReviewCap: () => {},
    linkIssue: () => {},
    prepareRecovery: (issue, requestedPr) => {
      const number = requestedPr ?? fixture.state.pr;
      fixture.state = prepareRecovery(fixture.state, issue, number, Date.now(), 100);
      return number;
    },
    eligible: () => fixture.issues,
    comment: (issue, body) => fixture.comments.push([issue, body]),
    run: createMockAgentRun(fixture),
    pullRequest: () => {
      fixture.pr.statusCheckRollup =
        fixture.checkSequences[Math.min(fixture.checkIndex++, fixture.checkSequences.length - 1)];
      return structuredClone(fixture.pr);
    },
    updatePullRequestBody: async (number, body) => {
      assert.equal(number, fixture.pr.number);
      fixture.pr.body = body;
      fixture.prBodyUpdates.push({ number, body });
    },
    pullRequestBody: () => fixture.pr.body,
    prComment: (number, body) => {
      assert.equal(number, fixture.pr.number);
      fixture.pr.comments.push({ body });
    },
    createIssue: (title, body) => {
      fixture.createdIssues.push({ title, body });
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
}

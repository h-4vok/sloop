import {
  createMockDispatcherHarness,
  runManifestMarker,
  workerBranchName,
} from '../dispatcher-test-support.mjs';
import { createStaleRemoteWorkerRecoveryManifests } from './createStaleRemoteWorkerRecoveryManifests.mjs';

export const createStaleRemoteWorkerRecovery = () => {
  const dispatcherHarness = createRecoveryHarness();
  const manifests = createStaleRemoteWorkerRecoveryManifests();
  const recovery = {
    current: manifests.current,
    published: [],
    claimCount: 0,
    comments: createRecoveryComments(manifests),
  };
  const workspace = configureRecoveryWorkspace(dispatcherHarness);
  dispatcherHarness.dependencies.remote = createRecoveryRemoteAdapter(recovery, manifests.original);

  return {
    dispatcherHarness,
    published: recovery.published,
    checkedOut: workspace.checkedOut,
    prepared: workspace.prepared,
    claimCount: () => recovery.claimCount,
  };
};

function createRecoveryHarness() {
  return createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,
    headRefName: 'codex/issue-1',
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1-40ae',
      workerRunId: 'replacement-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
    qaVerdicts: ['passed'],
  });
}

function createRecoveryComments(manifests) {
  const { previous, original } = manifests;
  return [
    { body: runManifestMarker(previous), createdAt: '2026-10-20T09:59:00Z' },
    { body: runManifestMarker(original), createdAt: '2026-10-20T10:00:00Z' },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=3 sha=older-sha waived=none additionalRounds=2 steer=Continue the prior request.',
      createdAt: '2026-10-20T10:00:30Z',
    },
    {
      body: '[HITL Review Cap] round=4 cap=3 sha=abc0 outstanding=Q1,Q2. Resolve with additional rounds.',
      createdAt: '2026-10-20T10:01:00Z',
    },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=4 sha=abc0 waived=none additionalRounds=4 steer=Fix Q1 and Q2, then request QA.',
      createdAt: '2026-10-20T10:02:00Z',
    },
  ];
}

function createRecoveryRemoteAdapter(recovery, original) {
  return {
    snapshot: () => createRecoverySnapshot(recovery.current, recovery.comments),
    reconcile: (_issue, key) => original.artifacts.includes(key),
    claim: () => {
      recovery.claimCount += 1;
    },
    publish: (_issue, manifest) => {
      recovery.current = manifest;
      recovery.published.push(manifest);
    },
  };
}

function createRecoverySnapshot(current, comments) {
  return {
    issue: 1,
    pr: 14,
    prState: 'OPEN',
    branch: 'codex/issue-1',
    sha: 'abc0',
    manifest: current,
    markers: [`sloop/v1/run/${current.runId}`],
    comments,
    now: Date.now(),
    leaseOwner: 'this-dispatcher',
  };
}

function configureRecoveryWorkspace(dispatcherHarness) {
  const checkedOut = [];
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => checkedOut.push(branch);
  const prepared = [];
  dispatcherHarness.dependencies.prepareWorkerBranch = (issue) => {
    prepared.push(issue);
    return { branch: workerBranchName(issue), mainBaseSha: 'new-base' };
  };
  return { checkedOut, prepared };
}

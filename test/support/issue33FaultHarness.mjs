import { createIsolatedTemporaryDirectory } from './temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFaultWorkspaceAdapter } from './issue33FaultWorkspaceAdapter.mjs';
import { createFaultAgentDependencies } from './issue33FaultAgentDependencies.mjs';
import { createFaultRemoteAdapter } from './issue33FaultRemoteAdapter.mjs';
import { createFaultLeaseDependencies } from './issue33FaultLeaseDependencies.mjs';

export function createMockFaultHarness({
  remoteManifest,
  outage = false,
  ambiguous = false,
  crashAfterClaim = false,
  initialState = {},
  pullRequestEvidence = {},
} = {}) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-fault-'));
  let state = structuredClone(initialState);
  let remote = remoteManifest;
  let claimCount = 0;
  let publishCount = 0;
  const publishedManifests = [];
  let prepareCount = 0;
  let hasSimulatedCrash = false;
  const comments = [];
  const reviews = [];
  const events = [];
  const pr = {
    number: 14,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-33-fault',

    headRefOid: 'abcdef1',

    body: 'Summary\n\nCloses #33',

    mergeStateStatus: 'CLEAN',

    mergeable: 'MERGEABLE',

    comments,

    reviews,

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  const snapshot = () => {
    if (outage) throw new Error('GitHub outage');
    return {
      issue: 33,

      markers: remote ? [`sloop/v1/run/${remote.runId}`, ...remote.artifacts] : [],

      manifest: remote,

      branch: remote?.branch,

      sha: remote?.baseSha,

      now: Date.now(),

      leaseOwner: '7001:33',
    };
  };
  const dependencies = {
    root,

    load: () => state,

    save: (next) => {
      if (crashAfterClaim && claimCount > 0 && next.workerRunId && !hasSimulatedCrash) {
        hasSimulatedCrash = true;
        throw new Error('crash before local acknowledgement');
      }
      state = structuredClone(next);
    },

    loadConfig: () => faultConfig,

    status: (verbose) => (verbose ? state : { issue: state.issue, status: state.status }),

    list: () => [],

    recoverLock: () => 'none',

    reset: () => {},

    resolveReviewCap: () => {},

    linkIssue: () => {},

    prepareRecovery: () => 14,

    eligible: () => [{ number: 33, title: 'fault injection' }],

    comment: (issue, body) => comments.push({ issue, body }),

    ...createFaultAgentDependencies({ events, comments, reviews, pr, pullRequestEvidence }),

    ...createFaultLeaseDependencies(),

    workspaceAdapter: createFaultWorkspaceAdapter({
      root,
      readState: () => state,
      readRemote: () => remote,
      onPrepare: () => {
        prepareCount += 1;
      },
    }),
    remote: createFaultRemoteAdapter({
      snapshot,
      readRemote: () => remote,
      writeRemote: (value) => {
        remote = value;
      },
      recordClaim: () => {
        claimCount += 1;
      },
      recordPublication: (manifest) => {
        publishCount += 1;
        publishedManifests.push(manifest);
      },
      isAmbiguous: () => ambiguous,
    }),
  };
  return {
    dependencies,

    counts: () => ({ claimCount, publishCount, prepareCount }),

    remote: () => remote,

    published: () => publishedManifests,

    events: () => events,
  };
}

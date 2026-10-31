import { createIsolatedTemporaryDirectory } from './temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFaultAgentDependencies } from './issue33FaultAgentDependencies.mjs';
import { createFaultLeaseDependencies } from './issue33FaultLeaseDependencies.mjs';
import { faultConfig } from './issue33FaultFixtures.mjs';
import { createIssue33FaultAdapters } from './createIssue33FaultAdapters.mjs';

export function createMockFaultHarness(options = {}) {
  const fixture = createFaultFixture(options);
  const dependencies = createFaultDependencies(fixture, options);
  return createPublicFaultHarness(fixture, dependencies);
}

function createFaultFixture(options) {
  const fixture = {
    root: createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-fault-')),
    state: structuredClone(options.initialState ?? {}),
    remote: options.remoteManifest,
    claimCount: 0,
    publishCount: 0,
    publishedManifests: [],
    prepareCount: 0,
    hasSimulatedCrash: false,
    comments: [],
    reviews: [],
    events: [],
  };
  fixture.pr = createFaultPullRequest(fixture);
  return fixture;
}

function createFaultPullRequest(fixture) {
  return {
    number: 14,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'codex/issue-33-fault',
    headRefOid: 'abcdef1',
    body: 'Summary\n\nCloses #33',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    comments: fixture.comments,
    reviews: fixture.reviews,
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
}

function createFaultDependencies(fixture, options) {
  return {
    ...createFaultLocalDependencies(fixture, options),
    ...createFaultAgentDependencies({
      events: fixture.events,
      comments: fixture.comments,
      reviews: fixture.reviews,
      pr: fixture.pr,
      pullRequestEvidence: options.pullRequestEvidence ?? {},
    }),
    ...createFaultLeaseDependencies(),
    ...createIssue33FaultAdapters(fixture, options),
  };
}

function createFaultLocalDependencies(fixture, options) {
  return {
    root: fixture.root,
    load: () => fixture.state,
    save: (next) => saveFaultState(fixture, next, options.crashAfterClaim),
    loadConfig: () => faultConfig,
    status: (verbose) =>
      verbose ? fixture.state : { issue: fixture.state.issue, status: fixture.state.status },
    list: () => [],
    recoverLock: () => 'none',
    reset: () => {},
    resolveReviewCap: () => {},
    linkIssue: () => {},
    prepareRecovery: () => 14,
    eligible: () => [{ number: 33, title: 'fault injection' }],
    comment: (issue, body) => fixture.comments.push({ issue, body }),
  };
}

function saveFaultState(fixture, next, crashAfterClaim) {
  if (shouldSimulateFaultCrash(fixture, next, crashAfterClaim)) {
    fixture.hasSimulatedCrash = true;
    throw new Error('crash before local acknowledgement');
  }
  fixture.state = structuredClone(next);
}

function shouldSimulateFaultCrash(fixture, next, crashAfterClaim) {
  return (
    crashAfterClaim && fixture.claimCount > 0 && next.workerRunId && !fixture.hasSimulatedCrash
  );
}

function createPublicFaultHarness(fixture, dependencies) {
  return {
    dependencies,
    counts: () => ({
      claimCount: fixture.claimCount,
      publishCount: fixture.publishCount,
      prepareCount: fixture.prepareCount,
    }),
    remote: () => fixture.remote,
    published: () => fixture.publishedManifests,
    events: () => fixture.events,
  };
}

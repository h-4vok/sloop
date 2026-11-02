import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseConfig, createExistingHumanReviewGuide } from './dispatcher-fixture-config.mjs';
import { createMockDispatcherDependencies } from './createMockDispatcherDependencies.mjs';

export function createMockDispatcherHarness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const fixture = createDispatcherFixture(issues, overrides);
  return createPublicDispatcherHarness(fixture, overrides);
}

function createDispatcherFixture(issues, overrides) {
  const fixture = createBaseFixture(issues, overrides);
  fixture.pr = createMockPullRequest(fixture, overrides);
  addExistingHumanGuides(fixture, overrides);
  fixture.dependencies = createMockDispatcherDependencies(fixture);
  return fixture;
}

function createBaseFixture(issues, overrides) {
  return {
    ...createReviewFixtureOptions(overrides),
    root: createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-')),
    state: overrides.initialState ?? {},
    issues,
    overrides,
    saves: [],
    comments: [],
    runs: [],
    prBodyUpdates: [],
    createdPrBodies: [],
    createdIssues: [],
    reviews: [],
    workerCount: 0,
    qaCount: 0,
    staffCount: 0,
    checkIndex: 0,
    activeLogger: undefined,
    qaBodies: overrides.qaBodies,
    staffBodies: overrides.staffBodies,
  };
}

function createReviewFixtureOptions(overrides) {
  return {
    qaVerdicts: overrides.qaVerdicts ?? ['passed'],
    staffVerdicts: overrides.staffVerdicts ?? ['approved'],
    publishEvidence: { worker: true, qa: true, staff: true, ...(overrides.publishEvidence ?? {}) },
    humanVerification: overrides.humanVerification ?? true,
    checkSequences: createCheckSequences(overrides),
  };
}

function createCheckSequences(overrides) {
  return overrides.checkSequences ?? [];
}

function createMockPullRequest(fixture, overrides) {
  const pullRequest = {
    number: overrides.prNumber ?? 14,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: overrides.headRefName ?? 'codex/issue-1',
    headRefOid: 'abc0',
    body: overrides.prBody ?? 'Summary',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    comments: [],
    reviews: fixture.reviews,
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  fixture.checkSequences = overrides.checkSequences ?? [pullRequest.statusCheckRollup];
  return pullRequest;
}

function addExistingHumanGuides(fixture, overrides) {
  for (let guide = 0; guide < (overrides.existingHumanGuides ?? 0); guide += 1)
    fixture.pr.comments.push({ body: createExistingHumanReviewGuide() });
  if (overrides.malformedHumanGuide)
    fixture.pr.comments.push({
      body: '[Human Review Guide] round=1 commit=abc1\n<!-- sloop-dispatcher-human-review-guide -->',
    });
}

function createPublicDispatcherHarness(fixture, overrides) {
  return {
    root: fixture.root,
    pr: fixture.pr,
    comments: fixture.comments,
    runs: fixture.runs,
    reviews: fixture.reviews,
    saves: fixture.saves,
    dependencies: fixture.dependencies,
    state: () => fixture.state,
    setState: (next) => {
      fixture.state = next;
    },
    counts: () => ({
      workerCount: fixture.workerCount,
      qaCount: fixture.qaCount,
      staffCount: fixture.staffCount,
    }),
    prBodyUpdates: fixture.prBodyUpdates,
    createdPrBodies: fixture.createdPrBodies,
    createdIssues: fixture.createdIssues,
    cfg: { ...baseConfig, ...overrides.config },
  };
}

import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseConfig, createExistingHumanReviewGuide } from './dispatcher-fixture-config.mjs';
import { createMockDispatcherDependencies } from './createMockDispatcherDependencies.mjs';

export function createMockDispatcherHarness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const fixture = {
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
    qaVerdicts: overrides.qaVerdicts ?? ['passed'],
    staffVerdicts: overrides.staffVerdicts ?? ['approved'],
    qaBodies: overrides.qaBodies,
    staffBodies: overrides.staffBodies,
    publishEvidence: { worker: true, qa: true, staff: true, ...(overrides.publishEvidence ?? {}) },
    humanVerification: overrides.humanVerification ?? true,
    checkSequences: overrides.checkSequences ?? [],
  };
  fixture.pr = {
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
  fixture.checkSequences = overrides.checkSequences ?? [fixture.pr.statusCheckRollup];
  for (let guide = 0; guide < (overrides.existingHumanGuides ?? 0); guide += 1)
    fixture.pr.comments.push({ body: createExistingHumanReviewGuide() });
  if (overrides.malformedHumanGuide)
    fixture.pr.comments.push({
      body: '[Human Review Guide] round=1 commit=abc1\n<!-- sloop-dispatcher-human-review-guide -->',
    });
  fixture.dependencies = createMockDispatcherDependencies(fixture);
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

import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  tmpdir,
  join,
  test,
  dispatch,
  prepareRecovery,
  resolveReviewCap,
  readState,
  writeState,
  artifactKey,
  createMockGitHubHost,
  createMockDispatcherHarness,
} from './dispatcher-test-support.mjs';

test('review-cap resolution uses the host for identity and publication while enforcing waiver safety', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-host-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1', 'Q2'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({ comments: [{ body: 'An unrelated issue comment.' }] });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [{ body: 'An unrelated pull request comment.' }],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    return '';
  });
  const options = {
    steer: 'ship this',

    abandon: false,

    waiveAllOutstanding: false,

    waivedFindingIds: ['q1', 'q2'],

    additionalRounds: 0,
  };

  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, waivedFindingIds: ['Q99'] },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        'o/r',
        fake.host,
      ),
    /waivers must name outstanding findings/,
  );
  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, waivedFindingIds: ['Q1'] },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        'o/r',
        fake.host,
      ),
    /findings remain/,
  );

  resolveReviewCap(options, { requiredPrChecks: ['pr-checks'] }, statePath, root, 'o/r', fake.host);
  const next = readState(statePath);

  assert.equal(next.status, 'ready_for_human_merge');
  assert.deepEqual(next.reviewCap.waivedFindingIds, ['Q1', 'Q2']);
  assert.equal(next.reviewCap.resolvedBy, 'octocat');
  assert.equal(next.reviewCap.resolvedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'api'),
    true,
  );
  assert.equal(fake.calls.find(({ args }) => args[0] === 'api').args.includes('--repo'), false);
  assert.throws(
    () =>
      resolveReviewCap(
        { ...options, abandon: true, additionalRounds: 1 },
        {},
        statePath,
        root,
        undefined,
        fake.host,
      ),
    /cannot be combined/,
  );
});

test('review-cap resolution creates an empty cap when resuming a ready PR recovery', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-recovery-'));
  const statePath = join(root, 'state.json');
  const recovered = prepareRecovery(
    { issue: 1, pr: 7, status: 'ready_for_human_merge', reviewRound: 1, completedIssues: [1] },
    1,
    7,
    1000,
    100,
  );
  writeState(recovered, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      });
    return '';
  });

  resolveReviewCap(
    {
      steer: 'resume with the local listing reproduction',

      abandon: false,

      waiveAllOutstanding: false,

      waivedFindingIds: [],

      additionalRounds: 2,
    },
    { requiredPrChecks: ['pr-checks'] },
    statePath,
    root,
    'o/r',
    fake.host,
  );

  const next = readState(statePath);

  assert.equal(next.status, 'worker_recovery_pending');
  assert.equal(next.reviewCap.capRound, 1);
  assert.deepEqual(next.reviewCap.outstandingFindingIds, []);
  assert.equal(next.reviewCap.additionalRounds, 0);
  assert.equal(next.reviewCap.steer, 'resume with the local listing reproduction');
});

test('review-cap abandonment requires an active review-cap run', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-abandon-inactive-'));
  const statePath = join(root, 'state.json');
  writeState({}, statePath);

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'stop this run',

          abandon: true,

          waiveAllOutstanding: false,

          waivedFindingIds: [],

          additionalRounds: 0,
        },
        {},
        statePath,
        root,
      ),
    /abandonment requires the active review-cap run/,
  );

  rmSync(root, { recursive: true, force: true });
});

test('review-cap resume rejects a remote manifest for a different PR', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-pr-mismatch-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const manifest = {
    protocol: 1,

    runId: 'remote-run',

    issue: 1,

    pr: 8,

    branch: 'codex/issue-1',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 2,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-run' })],
  };
  const remote = {
    snapshot: () => ({
      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      manifest,
    }),
  };
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        state: 'OPEN',

        headRefName: 'codex/issue-1',

        headRefOid: 'abc1234',

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],
      });
    return '';
  });

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'resume the reviewed work',

          abandon: false,

          waiveAllOutstanding: false,

          waivedFindingIds: [],

          additionalRounds: 1,
        },
        {},
        statePath,
        root,
        undefined,
        fake.host,
        remote,
      ),
    /remote manifest belongs to a different PR/,
  );

  rmSync(root, { recursive: true, force: true });
});

test('review-cap resume rejects a PR head that changed after remote reconciliation', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-head-mismatch-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const manifest = {
    protocol: 1,

    runId: 'remote-run',

    issue: 1,

    pr: 7,

    branch: 'codex/issue-1',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 2,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-run' })],
  };
  const remote = {
    snapshot: () => ({
      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      manifest,
    }),
  };
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        state: 'OPEN',

        headRefName: 'codex/issue-1-updated',

        headRefOid: 'def5678',

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],
      });
    return '';
  });

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'resume the reviewed work',

          abandon: false,

          waiveAllOutstanding: false,

          waivedFindingIds: [],

          additionalRounds: 1,
        },
        {},
        statePath,
        root,
        undefined,
        fake.host,
        remote,
      ),
    /PR head changed while reconciling remote state/,
  );
  assert.equal(readState(statePath).status, 'review_cap_pending');
  rmSync(root, { recursive: true, force: true });
});

test('review-cap waiver requires a clean PR with green checks', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-unhealthy-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        mergeable: 'CONFLICTING',

        mergeStateStatus: 'DIRTY',

        comments: [],

        statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      });
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    return '';
  });

  assert.throws(
    () =>
      resolveReviewCap(
        {
          steer: 'waive after review',

          abandon: false,

          waiveAllOutstanding: false,

          waivedFindingIds: ['Q1'],

          additionalRounds: 0,
        },
        { requiredPrChecks: ['pr-checks'] },
        statePath,
        root,
        undefined,
        fake.host,
      ),
    /green required checks and be clean\/mergeable/,
  );
  assert.equal(readState(statePath).status, 'review_cap_pending');
  rmSync(root, { recursive: true, force: true });
});

test('review-cap resume republishes the updated remote manifest after granting a round', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-review-cap-publish-'));
  const statePath = join(root, 'state.json');
  writeState(
    {
      issue: 1,

      pr: 7,

      branch: 'codex/issue-1',

      status: 'review_cap_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 2,

        outstandingFindingIds: ['Q1'],

        additionalRounds: 0,

        waivedFindingIds: [],
      },
    },
    statePath,
  );
  const manifest = {
    protocol: 1,

    runId: 'remote-run',

    issue: 1,

    pr: 7,

    branch: 'codex/issue-1',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 2,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-run' })],
  };
  const published = [];
  const remote = {
    snapshot: () => ({
      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      sha: 'abc1234',

      manifest,
    }),

    publish: (issue, nextManifest) => published.push({ issue, manifest: nextManifest }),
  };
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'api') return 'octocat';
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({
        number: 7,

        state: 'OPEN',

        headRefName: 'codex/issue-1',

        headRefOid: 'abc1234',

        mergeable: 'MERGEABLE',

        mergeStateStatus: 'CLEAN',

        comments: [],
      });
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    return '';
  });

  resolveReviewCap(
    {
      steer: 'resume the reviewed work',

      abandon: false,

      waiveAllOutstanding: false,

      waivedFindingIds: [],

      additionalRounds: 1,
    },
    {},
    statePath,
    root,
    undefined,
    fake.host,
    remote,
  );

  assert.equal(readState(statePath).status, 'worker_recovery_pending');
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    issue: 1,

    manifest: {
      ...manifest,

      phase: 'blocked',

      lease: undefined,
    },
  });
  rmSync(root, { recursive: true, force: true });
});

test('prepared remote recovery rejects a manifest branch mismatch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 7,

    initialState: {
      issue: 1,

      pr: 7,

      branch: 'codex/issue-1',

      status: 'worker_recovery_pending',

      workerRunId: 'prepared-run',

      preparedRecovery: true,

      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,

    runId: 'prepared-run',

    issue: 1,

    branch: 'codex/issue-99',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 1,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'prepared-run' })],
  };
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,

      issue: 1,

      pr: 7,

      prState: 'OPEN',

      branch: 'pending',

      manifest,

      markers: ['sloop/v1/run/prepared-run'],
    }),

    reconcile: () => true,

    claim: () => {},

    publish: () => {},
  };

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /manifest branch/);
});

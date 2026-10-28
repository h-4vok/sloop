import {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  acquire,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatcherLockPath,
  dispatch,
  pullRequest,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  artifactKey,
  createMockDispatcherHarness,
  assertPersistedDiagnostic,
} from './dispatcher-test-support.mjs';
import { DispatchWorkspace } from '../../src/application/dispatcher/services/DispatchWorkspace.js';

test('recovery adopts the open PR branch when persisted branch is absent', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 1,

      pr: 14,

      status: 'worker_recovery_pending',

      workerRunId: 'recovery-test',
    },
  });

  await DispatchWorkspace.prepareRecoveryWorker(
    dispatcherHarness.cfg,
    dispatcherHarness.dependencies,
    { number: 1, title: 'one' },
    undefined,
    undefined,
  );

  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().headSha, 'abc0');
});

test('dispatcher stops after one issue instead of draining the queue', async () => {
  const dispatcherHarness = createMockDispatcherHarness([
    { number: 1, title: 'first' },
    { number: 2, title: 'second' },
  ]);
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(dispatcherHarness.state().completedIssues, [1]);
});

test('new issue claim clears the completed issue PR context before validation', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [
      { number: 16, title: 'completed' },
      { number: 17, title: 'next issue', body: 'new acceptance criteria' },
    ],
    {
      headRefName: 'codex/issue-17',

      initialState: {
        issue: 16,

        status: 'ready_for_human_merge',

        pr: 16,

        branch: 'codex/issue-16',

        headSha: 'old-head',

        mainBaseSha: 'old-main',

        reviewRound: 9,

        lastCiFeedback: 'old CI feedback',

        lastQaFeedback: 'old QA feedback',

        lastStaffFeedback: 'old Staff feedback',

        taskContext: 'old task context',

        workerRunId: 'old-run',

        workerPid: 123,

        workerStartedAt: 1,

        workerHeartbeatAt: 1,

        workerRecoveryCount: 4,

        lastError: 'old error',

        completedIssues: [16],

        mainGreen: true,
      },
    },
  );
  const validatedPrs = [];
  const pullRequest = dispatcherHarness.dependencies.pullRequest;
  dispatcherHarness.dependencies.pullRequest = (pr) => {
    validatedPrs.push(pr);
    return pullRequest(pr);
  };

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const claimSave = dispatcherHarness.saves.find((saved) => saved.status === 'claimed');

  assert.deepEqual(claimSave, {
    completedIssues: [16],

    mainGreen: true,

    issue: 17,

    status: 'claimed',

    reviewRound: 1,

    drainStatus: 'running',

    updatedAt: claimSave.updatedAt,
  });
  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #16'), false);
  assert.equal(dispatcherHarness.runs[0].input.includes('old task context'), false);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-17');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(validatedPrs.length > 0, true);
  assert.equal(
    validatedPrs.every((pr) => pr === 14),
    true,
  );
  assert.deepEqual(dispatcherHarness.state().completedIssues, [16, 17]);
  assert.equal(dispatcherHarness.state().mainGreen, true);
});

test('QA changes return to Worker and QA is repeated', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 2, qaCount: 2, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa', 'worker', 'sloop-qa'],
  );
});

test('recovery detects stale Worker state, starts a new Worker and reuses the existing PR', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      now,
      100,
    ),
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('recovery must reuse the existing branch');
  };
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(checkedOut, 'codex/issue-1');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('Worker perdido')),
    true,
  );
});

test('recovery with a stale remote branch adopts the existing PR branch and reaches QA', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    headRefName: 'codex/issue-1-137e',

    initialState: {
      issue: 1,

      pr: 14,

      status: 'worker_recovery_pending',

      reviewRound: 4,

      workerPid: -1,

      workerStartedAt: now - 101,

      workerHeartbeatAt: now - 101,
    },
  });
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      protocol: 1,

      issue: 1,

      pr: 14,

      manifest: {
        protocol: 1,

        runId: 'recovery-run',

        issue: 1,

        pr: 14,

        branch: 'codex/issue-1-stale',

        baseSha: 'abcdef1',

        configFingerprint: 'test-config',

        phase: 'working',

        reviewRound: 4,

        contextCursor: '',

        artifacts: ['sloop-v1/run/recovery-artifact'],
      },

      markers: ['sloop/v1/run/recovery-run'],
    }),

    reconcile: () => true,

    claim: () => {},

    publish: () => {},
  };
  let prepared = 0;
  let checkedOut;
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    prepared += 1;
    throw new Error('must not create a second branch for an existing PR');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(prepared, 0);
  assert.equal(checkedOut, 'codex/issue-1-137e');
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.state().reviewRound, 4);
});

test('recovery accepts a collision-suffixed Worker branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1-071f' },
      1,
      14,
      now,
      100,
    ),
  });
  let checkedOut;
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(checkedOut, 'codex/issue-1-071f');
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
});

test('recovery explains why an issue is not eligible', async () => {
  const dispatcherHarness = createMockDispatcherHarness([], {
    initialState: {
      issue: 31,

      status: 'worker_running',

      pr: 54,

      branch: 'codex/issue-31',

      reviewRound: 9,

      workerPid: -1,
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => {
      assert.match(error.message, /Issue #31 cannot be recovered/);
      assert.match(error.message, /Automation Ready/);
      assert.match(error.message, /status=worker_running, pr=54, branch=codex\/issue-31/);
      assert.match(error.message, /gh issue view 31/);
      return true;
    },
  );
});

test('new branch preparation failure is persisted and does not leave a claimed run stuck', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fetch failed');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'blocked');
  assert.match(dispatcherHarness.state().lastError, /The loop stopped during blocked/);
  assert.equal(dispatcherHarness.state().lastErrorVerbose, 'fetch failed');
});

test('dispatcher preserves the external exit class from post-preflight branch preparation', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new CliFailure(5, 'git fetch failed: service unavailable');
  };
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 5,
  );

  assert.notEqual(dispatcherHarness.state().status, 'blocked');
});

test('empty diagnostic fallback persists concise blocked context separately from verbose output', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'blocked',
    'No diagnostic output was captured during blocked.',
    [/issue #1/],
  );

  assert.match(dispatcherHarness.state().lastError, /No diagnostic output was available/);
});

test('QA feedback persists concise context and the complete diagnostic', async () => {
  const diagnostic =
    '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n[Q1] fail - café output';
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],

    qaBodies: [diagnostic],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const persisted = dispatcherHarness.saves.find(
    (state) => state.status === 'qa_changes_requested',
  );
  assertPersistedDiagnostic(persisted, 'qa changes requested', diagnostic, [/issue #1/, /PR #14/]);
});

test('recovery failure persists concise issue and PR context with complete diagnostics', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      Date.now(),
      100,
    ),
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {
    throw new Error('recovery checkout failed\nexit 2');
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  assertPersistedDiagnostic(
    dispatcherHarness.state(),
    'worker recovery pending',
    'recovery checkout failed\nexit 2',
    [/issue #1/, /PR #14/],
  );
});

test('blocked issue with PR context enters recovery instead of a fresh claim', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'recover me' }], {
    initialState: {
      issue: 1,

      status: 'blocked',

      pr: 14,

      branch: 'codex/issue-1',

      headSha: 'old-head',

      reviewRound: 3,

      lastQaFeedback: 'actionable QA finding',
    },
  });
  dispatcherHarness.dependencies.prepareWorkerBranch = () => {
    throw new Error('fresh claim path must not run');
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.runs[0].input.includes('An existing PR is #14'), true);
  assert.equal(dispatcherHarness.runs[0].input.includes('actionable QA finding'), true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('recovery rejects a conflicting persisted branch', async () => {
  const now = Date.now();
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'main',

      status: 'worker_running',

      workerRunId: 'corrupt-recovery-state',

      workerPid: -1,

      workerStartedAt: now - 1000,

      workerHeartbeatAt: now - 1000,

      workerRecoveryCount: 0,

      reviewRound: 1,

      completedIssues: [],

      drainStatus: 'running',

      updatedAt: now,
    },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch main; found codex\/issue-1/,
  );
});

test('conflicting Worker PR is rejected before reviews', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }]);
  dispatcherHarness.dependencies.pullRequest = () => ({
    number: 14,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-1',

    headRefOid: 'abc1',

    mergeStateStatus: 'DIRTY',

    mergeable: 'CONFLICTING',

    comments: [{ body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1' }],

    reviews: [],

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /remains conflicting or dirty/);
});

test('failed PR CI returns the issue to a recovered Worker without local npm gates', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(
    dispatcherHarness.runs.some((run) => run.command === 'npm'),
    false,
  );
  const ciFailure = dispatcherHarness.saves.find((state) => state.status === 'ci_failed');
  assertPersistedDiagnostic(ciFailure, 'ci failed', '[CI] pr-checks: FAILURE', [
    /issue #1/,
    /PR #14/,
  ]);
});

test('successful role process without a published review blocks the dispatcher', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    publishEvidence: { qa: false },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /did not publish \[QA\/SDET Review\]/);
});

test('active live run remains exclusive while stale recovery is allowed', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,

      status: 'worker_running',

      workerPid: process.pid,

      workerHeartbeatAt: Date.now(),
    },
  });
  await assert.rejects(
    () => dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies),
    (error) => error.exitCode === 3 && /active run exists/.test(error.message),
  );
});

test('stale locks recover safely and reclaim markers are atomic', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  dispatcherHarness.dependencies.tryAcquire = () => (calls.push('tryAcquire'), false);
  dispatcherHarness.dependencies.readOwner = () => {
    calls.push('readOwner');
    throw new Error('corrupt owner');
  };
  dispatcherHarness.dependencies.tryBeginReclaim = () => (calls.push('tryBeginReclaim'), true);
  dispatcherHarness.dependencies.finishReclaim = () => calls.push('finishReclaim');
  dispatcherHarness.dependencies.onReclaim = () => calls.push('onReclaim');
  const first = acquire(dispatcherHarness.dependencies, 1);

  assert.match(first, /^[0-9a-f-]+$/);
  assert.deepEqual(calls, [
    'tryAcquire',
    'readOwner',
    'tryBeginReclaim',
    'onReclaim',
    'finishReclaim',
  ]);
});

test('stale lock recovery validates owner PIDs and removes dead owners', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-lock-owner-'));
  const lock = dispatcherLockPath(root);
  const ownerFile = join(lock, 'owner.json');
  mkdirSync(lock, { recursive: true });

  try {
    writeFileSync(ownerFile, JSON.stringify({ pid: 0 }));
    assert.throws(() => recoverStaleLock(root), /no valid PID/);

    writeFileSync(ownerFile, JSON.stringify({ pid: 4321 }));
    assert.throws(
      () => recoverStaleLock(root, (pid) => pid === 4321),
      (error) => error instanceof CliFailure && error.exitCode === 3,
    );

    assert.match(
      recoverStaleLock(root, () => false),
      /Recovered stale dispatcher lock/,
    );
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(lock, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher lock acquisition reclaims a stale owner after stale marker recovery', () => {
  const dispatcherHarness = createMockDispatcherHarness();
  const calls = [];
  let beginCount = 0;
  const dependencies = dispatcherHarness.dependencies;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => {
    calls.push('begin');
    beginCount += 1;
    return beginCount === 2;
  };
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim owner is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => calls.push('abandon');
  dependencies.onReclaim = () => calls.push('reclaim');
  dependencies.finishReclaim = () => calls.push('finish');

  const token = acquire(dependencies, 10);

  assert.equal(typeof token, 'string');
  assert.deepEqual(calls, ['begin', 'abandon', 'begin', 'reclaim', 'finish']);

  const liveOwnerDependencies = createMockDispatcherHarness().dependencies;
  liveOwnerDependencies.tryAcquire = () => false;
  liveOwnerDependencies.readOwner = () => ({ pid: 4321, createdAt: 1000 });
  liveOwnerDependencies.processAlive = () => true;

  assert.throws(
    () => acquire(liveOwnerDependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
});

test('dispatcher exhausts lock reclaim attempts when every stale marker reacquire fails', () => {
  const dependencies = createMockDispatcherHarness().dependencies;
  let abandonCount = 0;
  dependencies.tryAcquire = () => false;
  dependencies.readOwner = () => ({ pid: 4321, createdAt: 0 });
  dependencies.processAlive = () => false;
  dependencies.now = () => 1000;
  dependencies.tryBeginReclaim = () => false;
  dependencies.readReclaimOwner = () => {
    throw new Error('reclaim marker is missing');
  };
  dependencies.reclaimAgeMs = () => 100;
  dependencies.abandonReclaim = () => {
    abandonCount += 1;
  };

  assert.throws(
    () => acquire(dependencies, 10),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
  assert.equal(abandonCount, 3);
});

test('worker branch preparation rejects a dirty checkout before changing branches', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dirty-worktree-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    writeFileSync(join(root, 'untracked.txt'), 'local work');

    assert.throws(
      () => prepareWorkerBranch(12, root),
      (error) =>
        error instanceof CliFailure &&
        error.exitCode === 5 &&
        /working tree is dirty/.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatcher records role command errors as recoverable Worker failures', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => {
    throw new Error('agent command failed');
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /agent command failed/);
});

test('dispatcher times out when required PR checks remain pending', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [[{ name: 'pr-checks', status: 'IN_PROGRESS' }]],

    config: { checkTimeoutMs: -1 },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /PR checks did not finish before timeout/);
});

test('dispatcher polls pending PR checks until they pass', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'IN_PROGRESS' }],
      [{ name: 'pr-checks', status: 'IN_PROGRESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],

    config: { checkTimeoutMs: 60_000, checkPollIntervalMs: 0 },
  });
  const observedWaits = [];
  dispatcherHarness.dependencies.sleep = async (duration) => observedWaits.push(duration);
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.deepEqual(observedWaits, [0]);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher records malformed Worker completion metadata', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => 'Worker output omitted its PR result.';
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /WORKER_RESULT pr=<number> base=main/);
});

test('dispatcher rejects Worker metadata with an invalid PR base', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.run = async () => 'WORKER_RESULT pr=14 base=develop';
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /report an existing PR based on main/);
});

test('dispatcher rejects Worker evidence when the PR targets another base branch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  dispatcherHarness.dependencies.pullRequest = () => ({
    ...dispatcherHarness.pr,

    baseRefName: 'develop',
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /must target main/);
});

test('recovery refuses to run Worker against a closed PR', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'closed-pr-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  dispatcherHarness.dependencies.pullRequest = () => ({
    ...dispatcherHarness.pr,

    state: 'CLOSED',
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('recovery refuses to run Worker when the PR has no head branch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'headless-pr-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  let pullRequestCalls = 0;
  dispatcherHarness.dependencies.pullRequest = () => {
    pullRequestCalls += 1;
    return { ...dispatcherHarness.pr, headRefName: undefined };
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 4);
  assert.equal(pullRequestCalls, 2);
  assert.match(dispatcherHarness.state().lastError, /no recoverable open head branch/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

test('failed CI pauses at the review cap instead of launching another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
    ],

    config: { maxReviewRounds: 1 },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().lastCiFeedback, '[CI] pr-checks: FAILURE');
});

test('escalated Arbiter findings move the run to human review without another Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - unresolved contract finding',
    ],

    arbiterAction: 'escalate',

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterCommand: { command: 'codex', args: [] },
    },
  });

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'human_review_required');
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
});

test('dispatcher continues when remote claim failure is reconciled by its artifact marker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  let claimAttempts = 0;
  let reconciliations = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({ issue: 1, markers: [] }),

    claim: () => {
      claimAttempts += 1;
      throw new Error('remote claim response was lost');
    },

    reconcile: () => {
      reconciliations += 1;
      return true;
    },

    publish: () => {},
  };

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(claimAttempts, 1);
  assert.equal(reconciliations >= 1, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher continues when failed remote publication is reconciled', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'remote-recovery-run',

      status: 'worker_recovery_pending',

      reviewRound: 1,
    },
  });
  const manifest = {
    protocol: 1,

    runId: 'remote-recovery-run',

    issue: 1,

    pr: 14,

    branch: 'codex/issue-1',

    baseSha: 'abc1234',

    configFingerprint: 'config-v1',

    phase: 'blocked',

    reviewRound: 1,

    contextCursor: '',

    artifacts: [artifactKey('run', { issue: 1, runId: 'remote-recovery-run' })],
  };
  const published = [];
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      issue: 1,

      pr: 14,

      prState: 'OPEN',

      branch: 'codex/issue-1',

      manifest,

      markers: ['sloop/v1/run/remote-recovery-run'],
    }),

    claim: () => assert.fail('existing remote run must not be claimed again'),

    reconcile: () => true,

    publish: () => {
      published.push('attempted');
      throw new Error('remote publication response was lost');
    },
  };
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(published.length > 0, true);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
});

test('dispatcher pauses an over-budget recovery before launching a replacement Worker', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'over-budget-recovery',

      status: 'worker_recovery_pending',

      reviewRound: 3,
    },

    config: { maxReviewRounds: 1 },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(
    dispatcherHarness.comments.some(([, body]) => body.includes('[HITL Review Cap]')),
    true,
  );
});

test('Arbiter waits for its configured review threshold before intervening', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 3,

      arbiterStagnatingAppearances: 99,

      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 0);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(
    dispatcherHarness.runs.some((spec) => spec.input?.includes('Use the Arbiter contract')),
    false,
  );
});

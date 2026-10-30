import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
  mkdirSync,
  writeFileSync,
  join,
  vi,
  checkoutWorkerBranch,
  command,
} from '../dispatcher-test-support.mjs';

test('review cap pauses before a replacement Worker is launched', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    config: { maxReviewRounds: 1 },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.state().reviewRound, 2);
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.deepEqual(dispatcherHarness.state().reviewCap.outstandingFindingIds, []);
});

test('a local HITL budget and steer are included in the resumed Worker context', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      workerRunId: 'resumed-worker-session',

      status: 'worker_recovery_pending',

      reviewRound: 2,

      reviewCap: {
        capRound: 1,

        additionalRounds: 1,

        waivedFindingIds: ['Q4'],

        outstandingFindingIds: ['Q4'],

        decisionSha: 'abc0',

        steer: 'Do not change GitHub configuration.',
      },
    },

    config: {
      maxReviewRounds: 1,

      workerCommand: {
        command: 'codex',

        args: ['exec', '--sandbox', 'read-only'],

        sessions: true,
      },
    },
  });
  mkdirSync(join(dispatcherHarness.root, '.sloop'), { recursive: true });
  writeFileSync(
    join(dispatcherHarness.root, '.sloop', 'sessions.json'),
    JSON.stringify({ 'resumed-worker-session\u00001\u0000worker': 'saved-session' }),
  );
  const observedRunSpecs = [];
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    observedRunSpecs.push(spec);
    return originalRun(spec);
  };
  vi.doMock('node:crypto', async (importOriginal) => {
    const crypto = await importOriginal();
    return { ...crypto, randomUUID: () => 'resumed-worker-session' };
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  try {
    vi.resetModules();
    const dispatcherModule = await import('../../../src/dispatcher.js');
    await dispatcherModule.dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    vi.doUnmock('node:crypto');
    vi.resetModules();
  }

  assert.match(
    dispatcherHarness.runs[0].input,
    /HITL steer \(binding\): Do not change GitHub configuration/,
  );
  assert.equal(observedRunSpecs[0].env.SLOOP_SESSION, 'saved-session');
});

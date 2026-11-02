import {
  assert,
  test,
  command,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('configured Arbiter upholds a finding and adds a Worker round', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested', 'passed'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  dispatcherHarness.pr.comments.push({
    body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1\n\n[Human Verification]\n1. Repeat the check.',

    createdAt: '0',
  });
  dispatcherHarness.reviews.push({ body: '[Staff Review] round=1 verdict=approved commit=abc1' });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
  assert.match(dispatcherHarness.state().lastQaFeedback, /Worker steering/);
  assert.ok(dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')));
  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
});

test('Arbiter excludes findings already closed by an overrule decision', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,

      pr: 14,

      branch: 'codex/issue-1',

      status: 'worker_recovery_pending',

      reviewRound: 1,

      workerRunId: 'arbiter-filter-test',

      arbiterDecisions: [{ findingId: 'Q1', action: 'overrule' }],
    },

    qaVerdicts: ['changes_requested', 'passed'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - previously overruled finding\n- [Q2] fail - still open finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterStagnatingAppearances: 1,

      arbiterCommand: { command: 'codex', args: [] },
    },

    arbiterFindingId: 'Q2',
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q2', owner: 'qa', summary: '- [Q2] fail - still open finding' },
  ]);
});

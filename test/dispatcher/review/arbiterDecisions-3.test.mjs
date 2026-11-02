import {
  assert,
  writeFileSync,
  test,
  command,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('configured Arbiter protocol failure stops the loop and preserves intervention budget', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
    },
  });
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (spec.input?.includes('Use the Arbiter contract')) {
      const outputIndex = spec.args.indexOf('--output-last-message');
      writeFileSync(spec.args[outputIndex + 1], '{invalid');
      return 'Codex execution metadata';
    }
    return originalRun(spec);
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().arbiterInterventions ?? 0, 0);
  assert.match(dispatcherHarness.state().lastErrorVerbose, /Expected property name/);
});

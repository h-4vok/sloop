import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';

test('existing human guide for the current commit is not published twice', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 1 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('duplicate human guides for the current commit block ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { existingHumanGuides: 2 });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(
    dispatcherHarness.state().lastError,
    /Expected exactly one \[Human Review Guide\].*duplicates/,
  );
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('malformed current human guide blocks ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { malformedHumanGuide: true });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /not dispatcher-rendered/);
  assert.equal(
    dispatcherHarness.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length,
    0,
  );
});

test('incomplete Worker human-verification evidence blocks before ready_for_human_merge', async () => {
  const dispatcherHarness = createMockDispatcherHarness(undefined, { humanVerification: false });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'worker_recovery_pending');
  assert.match(dispatcherHarness.state().lastError, /complete \[Human Verification\] guide/);
});

import {
  assert,
  test,
  dispatch,
  pullRequest,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

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

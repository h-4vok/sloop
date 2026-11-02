import {
  assert,
  test,
  command,
  runCommand,
  dispatch,
  createMockDispatcherHarness,
  maxRoundsForUserBudget,
  selectIssues,
  issueLabelNames,
  withIssueClosingReference,
  hasCommit,
} from '../dispatcher-test-support.mjs';

test('failed retries retain diagnostics from every unsuccessful attempt', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',

            args: [
              '-e',
              "process.stdout.write('retry stdout\\n'); process.stderr.write('retry stderr\\n'); process.exit(17)",
            ],

            retries: 1,
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /failed after 2 attempt\(s\)/);
      assert.match(error.message, /attempt 1: exit 17/);
      assert.match(error.message, /attempt 2: exit 17/);
      assert.equal((error.message.match(/retry stdout/g) ?? []).length, 2);
      assert.equal((error.message.match(/retry stderr/g) ?? []).length, 2);
      return true;
    },
  );
});

test('dispatcher-generated body is used by the initial PR creation path', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 17, title: 'seventeen', body: 'criteria' }],
    {
      workerCreatesPr: true,
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';

  assert.equal(dispatcherHarness.runs[0].env.SLOOP_PR_BODY, 'Closes #17');
  assert.deepEqual(dispatcherHarness.createdPrBodies, ['Closes #17']);
  assert.equal((dispatcherHarness.createdPrBodies[0].match(/^Closes #17$/gm) ?? []).length, 1);
});

test('additional rounds mean future rounds from the current round', () => {
  assert.equal(maxRoundsForUserBudget(3, 9, 2), 10);
  assert.equal(maxRoundsForUserBudget(3, 2, 2), 3);
  assert.equal(maxRoundsForUserBudget(3, 9, 6), 14);
  assert.equal(maxRoundsForUserBudget(3, 9, 0), 3);
});

test('shared issue selector orders configured priorities then numeric ties', () => {
  const issues = [
    { number: 20, title: 'unprioritized' },
    { number: 12, title: 'p1', labels: ['Priority: P1'] },
    { number: 8, title: 'p0 later', labels: ['Priority: P0'] },
    { number: 3, title: 'p0 first', labels: ['Priority: P0'] },
  ];

  assert.deepEqual(
    selectIssues(issues, ['Priority: P0', 'Priority: P1']).map(({ number }) => number),
    [3, 8, 12, 20],
  );
});

test('issue label normalization accepts GitHub label objects', () => {
  assert.deepEqual(issueLabelNames([{ name: 'Priority: P0' }, 'Automation Ready']), [
    'Priority: P0',
    'Automation Ready',
  ]);
});

test('public command and commit helpers cover optional and invalid inputs', async () => {
  assert.equal(command(undefined, 1), undefined);
  assert.deepEqual(command(['node', '-e', ''], 1), {
    command: 'node',

    args: ['-e', ''],

    timeoutMs: 120000,

    retries: 0,

    logInvocation: undefined,
  });
  assert.deepEqual(command({ command: 'node', args: [] }, 1), {
    command: 'node',

    args: [],

    timeoutMs: 120000,

    retries: 0,

    logInvocation: undefined,
  });
  assert.throws(() => command({ command: 'node && bad', args: [] }, 1), /shell operators/);
  assert.throws(() => command({ command: 'node', args: ['ok', 1] }, 1), /string array/);
  assert.equal(await runCommand(undefined), '');
  assert.equal(hasCommit(undefined, undefined), true);
  assert.equal(hasCommit(undefined, 'abc'), false);
  assert.equal(hasCommit('not evidence', 'abc'), false);
  assert.equal(hasCommit('commit=abc\n', 'abcdef'), true);
  assert.equal(hasCommit('commit=abcdef', 'abc'), false);
  assert.equal(
    withIssueClosingReference('Closes #2\nBody', 2, [2, 4]),
    'Body\n\nCloses #2\nCloses #4',
  );
  assert.equal(withIssueClosingReference('Body', 2), 'Body\n\nCloses #2');
  assert.equal(withIssueClosingReference('', 7), 'Closes #7');
  assert.throws(() => maxRoundsForUserBudget(-1, 1, 0), /base review-round/);
  assert.throws(() => maxRoundsForUserBudget(1, 0, 0), /current review round/);
  assert.throws(() => maxRoundsForUserBudget(1, 1, -1), /additional review rounds/);
});

import {
  assert,
  test,
  dispatch,
  createMockDispatcherHarness,
  readFileSync,
  readdirSync,
  join,
  command,
  pullRequest,
} from '../dispatcher-test-support.mjs';

test('dispatcher reconciles a PR when the Worker omits its result marker', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const runWorkerRole = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    const output = await runWorkerRole(spec);
    return spec.input?.includes('Use the worker skill')
      ? 'Done. PR [#14](https://github.com/example/repo/pull/14) targets main.'
      : output;
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(dispatcherHarness.state().pr, 14);
  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(
    dispatcherHarness.runs.map(({ input }) => input.includes('Use the sloop-qa skill')),
    [false, true],
  );
});

test('dispatcher runs Worker and QA and uses Markdown PR evidence', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'ready_for_human_merge');
  assert.deepEqual(dispatcherHarness.counts(), { workerCount: 1, qaCount: 1, staffCount: 0 });
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'sloop-qa'],
  );
  assert.deepEqual(
    dispatcherHarness.runs.map((run) => run.args.slice(-2)),
    [
      ['--sandbox', 'read-only'],
      ['--sandbox', 'read-only'],
    ],
  );
  assert.equal(dispatcherHarness.runs[0].env.SLOOP_ISSUE_NUMBER, '1');
  assert.match(dispatcherHarness.runs[0].input, /exactly one \[Worker\] evidence comment/);
  assert.match(
    dispatcherHarness.runs[0].input,
    /repository's own AGENTS\.md, scripts, and workflow instructions/,
  );
  assert.doesNotMatch(dispatcherHarness.runs[0].input, /npm run pr-checks|canonical gate/);
  const published = await dispatcherHarness.dependencies.pullRequest(14);
  assert.equal(
    published.comments.filter((comment) => comment.body.startsWith('[QA/SDET Review]')).length,
    1,
  );
  assert.equal(dispatcherHarness.reviews.length, 0);
  assert.match(dispatcherHarness.runs[1].input, /gh pr comment --body-file/);
  const guide =
    dispatcherHarness.comments.find(([, body]) => body.startsWith('[Human Review Guide]'))?.[1] ??
    '';
  assert.match(guide, /commit=abc1/);
  assert.match(guide, /Run the focused command/);
  assert.match(guide, /documented output appears/);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().mainBaseSha, 'main-sha-1');
  const runDirectories = readdirSync(join(dispatcherHarness.root, '.sloop', 'runs'));
  const events = runDirectories.flatMap((directory) =>
    readFileSync(join(dispatcherHarness.root, '.sloop', 'runs', directory, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  assert.ok(events.some((event) => event.type === 'context'));
  assert.ok(events.some((event) => event.type === 'transition'));
  assert.ok(events.some((event) => event.type === 'prompt'));
  assert.ok(events.some((event) => event.type === 'result'));
  assert.ok(events.some((event) => event.type === 'stdout'));
  assert.ok(events.some((event) => event.type === 'stderr'));
  assert.ok(events.some((event) => event.type === 'codex'));
  assert.ok(events.every((event) => Number.isInteger(event.seq)));
});

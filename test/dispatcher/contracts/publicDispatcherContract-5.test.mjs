import {
  createIsolatedTemporaryDirectory,
  assert,
  writeFileSync,
  tmpdir,
  join,
  test,
  defaultProcessAlive,
  linkIssueToActiveRun,
  readState,
  writeState,
  createMockGitHubHost,
} from '../dispatcher-test-support.mjs';

test('dispatcher state persistence, PID probe, and link operations remain deterministic through injected GitHub host', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-dispatcher-host-'));
  const statePath = join(root, 'state.json');

  assert.deepEqual(readState(statePath), {});
  writeFileSync(statePath, '{bad');
  assert.match(readState(statePath).lastError, /state corruption/);
  writeState({ issue: 1, status: 'claimed' }, statePath);
  assert.equal(readState(statePath).issue, 1);
  assert.throws(
    () => linkIssueToActiveRun(2, statePath, root),
    /one active run with an existing PR/,
  );
  assert.equal(defaultProcessAlive(-1), false);
  assert.equal(defaultProcessAlive(process.pid), true);

  writeState({ issue: 1, pr: 7, status: 'claimed', linkedClosingIssues: [4] }, statePath);
  const fake = createMockGitHubHost((args) => {
    if (args[0] === 'pr' && args[1] === 'view')
      return JSON.stringify({ body: 'Summary', comments: [] });
    if (args[0] === 'issue' && args[1] === 'view')
      return JSON.stringify({ number: 2, state: 'OPEN', comments: [] });
    return '';
  });
  linkIssueToActiveRun(2, statePath, root, undefined, fake.host);
  assert.deepEqual(readState(statePath).linkedClosingIssues, [4, 2]);
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'edit'),
    true,
  );
  assert.equal(
    fake.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'comment').length,
    2,
  );
  assert.equal(
    fake.calls.some(({ args }) => args[0] === 'pr' && args[1] === 'comment'),
    true,
  );
});

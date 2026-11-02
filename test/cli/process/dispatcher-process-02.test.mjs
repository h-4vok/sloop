import {
  createIsolatedTemporaryDirectory,
  assert,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  childProcessInvocation,
  checkoutWorkerBranch,
  command,
  dispatch,
  eligible,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  readState,
  runDispatcherCli,
  writeState,
  createMockGitHubHost,
  createMockDispatcherHarness,
} from '../../dispatcher/dispatcher-test-support.mjs';

test('review-cap abandonment resumes safely after partial side effects', () => {
  const fixture = createAbandonmentFixture();

  resolveReviewCap(fixture.options, {}, fixture.statePath, fixture.root, undefined, fixture.host);

  assert.equal(readState(fixture.statePath).status, 'abandoned');
  assertAbandonmentSideEffects(fixture.calls);
  resumeCompletedAbandonment(fixture);
});

function createAbandonmentFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-abandon-host-'));
  const statePath = join(root, 'state.json');
  const state = {
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
  };
  writeState(state, statePath);
  const host = createMockGitHubHost((args) => {
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ number: 7, comments: [] });
    return '';
  });
  return {
    root,
    statePath,
    state,
    host: host.host,
    calls: host.calls,
    options: {
      steer: 'stop safely',
      abandon: true,
      waiveAllOutstanding: false,
      waivedFindingIds: [],
      additionalRounds: 0,
    },
  };
}

function assertAbandonmentSideEffects(calls) {
  const commands = calls.map(({ args }) => args.slice(0, 2).join(' '));
  assert.ok(commands.includes('pr close'));
  assert.ok(commands.includes('issue edit'));
  assert.ok(commands.includes('issue close'));
}

function resumeCompletedAbandonment(fixture) {
  writeState(
    {
      ...fixture.state,
      status: 'abandon_pending',
      abandonment: {
        steer: 'stop safely',
        commentPublished: true,
        prClosed: true,
        labelled: true,
        issueClosed: true,
      },
    },
    fixture.statePath,
  );
  const resumed = createMockGitHubHost(() => {
    throw new Error('completed actions must not repeat');
  });
  resolveReviewCap(fixture.options, {}, fixture.statePath, fixture.root, undefined, resumed.host);
  assert.equal(readState(fixture.statePath).status, 'abandoned');
}
test('Windows batch commands use cmd.exe without Node shell mode', () => {
  assert.deepEqual(
    childProcessInvocation(
      'C:\\tools\\codex.cmd',
      ['exec', '--full-auto'],
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    ),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',

      args: ['/d', '/s', '/v:off', '/c', '""C:\\tools\\codex.cmd" "exec" "--full-auto""'],

      windowsVerbatimArguments: true,
    },
  );
});

test('Windows executable resolution selects an npm command shim', () => {
  assert.equal(
    resolveExecutable('codex', 'win32', () => [
      'C:\\Program Files\\nodejs\\codex',
      'C:\\Program Files\\nodejs\\codex.cmd',
      'C:\\tools\\codex.exe',
    ]),
    'C:\\Program Files\\nodejs\\codex.cmd',
  );
});

test('executable resolution leaves Unix commands and explicit paths unchanged', () => {
  const unexpectedLookup = () => {
    throw new Error('lookup should not run');
  };

  assert.equal(resolveExecutable('codex', 'linux', unexpectedLookup), 'codex');
  assert.equal(
    resolveExecutable('C:\\tools\\codex.exe', 'win32', unexpectedLookup),
    'C:\\tools\\codex.exe',
  );
});

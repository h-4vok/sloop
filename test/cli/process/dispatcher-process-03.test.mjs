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

test('Windows batch commands execute from paths containing spaces', (t) => {
  if (process.platform !== 'win32') {
    t.skip('requires Windows cmd.exe');
    return;
  }

  const directory = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop batch command-'));
  const executable = join(directory, 'echo argument.cmd');
  writeFileSync(executable, '@echo off\r\necho %~1\r\n');

  try {
    const launch = childProcessInvocation(executable, ['expected'], 'win32', process.env.ComSpec);
    const result = spawnSync(launch.command, launch.args, {
      encoding: 'utf8',

      shell: false,

      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'expected');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows batch commands reject cmd.exe syntax in argv before launch', () => {
  assert.throws(
    () =>
      childProcessInvocation(
        'C:\\tools\\codex.cmd',
        ['SAFE" & echo INJECTED & rem "'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    /unsafe cmd\.exe syntax/,
  );
});

test('synchronous Windows batch shims preserve verbatim cmd.exe command text', () => {
  let invocation;
  const output = runSyncCommand(
    'C:\\Program Files\\GitHub CLI\\gh.cmd',
    ['pr', 'view', '40'],
    (command, args, options) => {
      invocation = { command, args, options };
      return 'ok';
    },
    'win32',
    'C:\\Windows\\System32\\cmd.exe',
  );

  assert.equal(output, 'ok');
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',

    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      '""C:\\Program Files\\GitHub CLI\\gh.cmd" "pr" "view" "40""',
    ],

    options: {
      cwd: process.cwd(),

      encoding: 'utf8',

      stdio: ['ignore', 'pipe', 'pipe'],

      windowsVerbatimArguments: true,
    },
  });
});

test('non-batch commands preserve their executable and arguments', () => {
  assert.deepEqual(childProcessInvocation('codex', ['exec'], 'win32'), {
    command: 'codex',

    args: ['exec'],
  });
});

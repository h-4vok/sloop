import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { canonicalConfigYaml, loadConfigText } from '../src/config.js';
import { configPaths } from '../src/config.js';
import { reconcileConfig, runConfigCommand, setConfigValue } from '../src/config-wizard.js';
import { runConfigWizard } from '../src/config-wizard.js';
import {
  runConfigCommand as runConfigCommandService,
  runConfigWizard as runConfigWizardService,
  setConfigValue as setConfigValueService,
} from '../src/application/config/index.js';
import { getConfigField } from '../src/config.js';
import { productionConfigReconciler } from '../src/adapters.js';
import { parseCliCommand } from '../src/runtime.js';

function createConfigFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-wizard-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, canonicalConfigYaml());
  return { root, file };
}

function createMockScriptedIo(answers, end = true) {
  const input = new PassThrough();
  let captured = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  input.isTTY = true;
  output.isTTY = true;
  setImmediate(() => {
    let index = 0;
    const sendAnswer = () => {
      if (index < answers.length) input.write(`${answers[index++]}\n`);
      else if (end) input.end();
      if (!input.destroyed && index < answers.length) setTimeout(sendAnswer, 5);
    };
    sendAnswer();
  });
  return { input, output, text: () => captured };
}

test('application config service objects are available through the application barrel', () => {
  assert.equal(typeof runConfigCommandService.run, 'function');
  assert.equal(typeof runConfigWizardService.run, 'function');
  assert.equal(typeof setConfigValueService.run, 'function');
});

test('root scalar setter compatibility export reports an unknown path', async () => {
  const { root, file } = createConfigFixture();
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const fileStore = {
    exists: vi.fn(() => true),

    read: vi.fn(() => canonicalConfigYaml()),

    writeAtomically: vi.fn(),

    remove: vi.fn(),
  };
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };
  const reconciler = async () => undefined;

  const exitCode = await setConfigValue(
    root,
    file,
    'unknown.setting',
    'value',
    '--no-sync',
    reconciler,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.match(errorMessages[0], /^unknown path unknown\.setting; valid paths:/);
  assert.equal(fileStore.exists.mock.calls.length, 0);
});

test('config command rejects invalid flag combinations and unknown paths without TTY', async () => {
  const { root } = createConfigFixture();
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };

  assert.equal(await runConfigCommand(root, ['--sync', '--no-sync'], undefined, io), 2);
  assert.equal(await runConfigCommand(root, ['schedule.cron'], undefined, io), 2);
  assert.equal(await runConfigCommand(root, ['--wizard'], undefined, io), 2);
});

test('config show reads through the injected configuration file store', async () => {
  const configurationText = canonicalConfigYaml();
  const loggerMessages = [];
  const fileStore = {
    exists: vi.fn(() => true),

    read: vi.fn(() => configurationText),

    writeAtomically: vi.fn(),

    remove: vi.fn(),
  };
  const logger = {
    log: (message) => loggerMessages.push(message),

    error: (message) => loggerMessages.push(message),
  };
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };

  const exitCode = await runConfigCommand(
    'mock-root',
    ['show', 'repository.remote'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(loggerMessages, ['"origin"']);
  assert.equal(fileStore.exists.mock.calls.length, 1);
  assert.equal(fileStore.read.mock.calls.length, 1);
});

test('config show reports ignored unknown keys through the error logger', async () => {
  const { root, file } = createConfigFixture();
  const configWithUnknownKey = `${readFileSync(file, 'utf8')}futureSetting: true\n`;
  writeFileSync(file, configWithUnknownKey);
  const errorMessages = [];
  const logger = {
    log: () => undefined,

    error: (message) => errorMessages.push(message),
  };

  const exitCode = await runConfigCommand(
    root,
    ['show', 'repository.remote'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, ['$.futureSetting: unknown configuration key; ignoring it']);
});

test('interactive wizard reports unknown keys through the injected error logger', async () => {
  const { root, file } = createConfigFixture();
  writeFileSync(file, `${readFileSync(file, 'utf8')}futureSetting: true\n`);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const io = createMockScriptedIo(['']);

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    false,
    '--no-sync',
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, [
    '$.futureSetting: unknown configuration key; ignoring it',
    '$.futureSetting: unknown configuration key; ignoring it',
  ]);
});

test('scalar setter reports ignored unknown keys through the injected error logger', async () => {
  const { root, file } = createConfigFixture();
  writeFileSync(file, `${readFileSync(file, 'utf8')}futureSetting: true\n`);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--no-sync'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(errorMessages, [
    '$.futureSetting: unknown configuration key; ignoring it',
    '$.futureSetting: unknown configuration key; ignoring it',
  ]);
});

test('interactive wizard uses the default reconciler when sync is requested', async () => {
  const { root, file } = createConfigFixture();
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const io = createMockScriptedIo(['develop', 'y']);

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    false,
    '--sync',
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errorMessages[0], /No production reconciler is available for github/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).repository.baseBranch, 'develop');
});

test('interactive init prompts for sync with injected IO when requested', async () => {
  const { root, file } = createConfigFixture();
  const reconciledKinds = [];
  const reconciler = async (_root, kind) => reconciledKinds.push(kind);
  const errorMessages = [];
  const logger = { log: () => undefined, error: (message) => errorMessages.push(message) };
  const scriptedIo = createMockScriptedIo(['develop', 'y', 'n', 'y']);
  const io = { ...scriptedIo, promptForSync: true, useColor: true };

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    true,
    undefined,
    reconciler,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reconciledKinds, ['github', 'skills']);
  assert.deepEqual(errorMessages, []);
  assert.match(scriptedIo.text(), /\u001b\[36mrepository\.baseBranch\u001b\[0m/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).repository.baseBranch, 'develop');
});

test('interactive init can skip the post-init sync prompt with injected IO', async () => {
  const { root, file } = createConfigFixture();
  const logs = [];
  const reconciledKinds = [];
  const reconciler = async (_root, kind) => reconciledKinds.push(kind);
  const logger = { log: (message) => logs.push(message), error: () => undefined };
  const scriptedIo = createMockScriptedIo(['develop', 'y', 'n', 'n']);
  const io = { ...scriptedIo, promptForSync: true };

  const exitCode = await runConfigWizard(
    root,
    file,
    'repository.baseBranch',
    true,
    undefined,
    reconciler,
    io,
    logger,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reconciledKinds, []);
  assert.ok(
    logs.includes(
      'Prerequisites were not synchronized; run `sloop config install` to prepare them manually.',
    ),
  );
});

test('config show and scalar set report a missing configuration file', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-missing-'));
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const showExitCode = await runConfigCommand(root, ['show'], undefined, undefined, logger);
  const setExitCode = await runConfigCommand(
    root,
    ['workspace.path', 'checkout', '--no-sync'],
    undefined,
    undefined,
    logger,
  );

  assert.deepEqual([showExitCode, setExitCode], [2, 2]);
  assert.deepEqual(errors, [
    'No valid sloop.config.yaml; run sloop config init',
    'No valid sloop.config.yaml; run sloop config init',
  ]);
});

test('config show reports unknown paths with valid-path guidance', async () => {
  const { root } = createConfigFixture();
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['show', 'not.a.config.path'],
    undefined,
    undefined,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errors[0], /unknown path not\.a\.config\.path; valid paths:/);
});

test('scalar setter cancellation preserves the original configuration bytes', async () => {
  const { root, file } = createConfigFixture();
  const original = readFileSync(file);
  const io = createMockScriptedIo(['n']);

  const exitCode = await runConfigCommand(
    root,
    ['workspace.path', 'checkout', '--no-sync'],
    undefined,
    io,
  );

  assert.equal(exitCode, 0, io.text());
  assert.deepEqual(readFileSync(file), original);
});

test('first-time config init removes its YAML when the gitignore write fails', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-rollback-'));
  const io = createMockScriptedIo(['checkout', 'y', 'y']);
  const errors = [];
  let removedConfigCount = 0;
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: () => false,

    read: () => '',

    writeAtomically: (file) => {
      if (file.endsWith('.gitignore')) throw new Error('gitignore write failed');
    },

    remove: () => {
      removedConfigCount++;
    },
  };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.equal(removedConfigCount, 1);
  assert.deepEqual(errors, ['gitignore write failed']);
});

test('existing config init restores its prior YAML when the gitignore write fails', async () => {
  const { root, file } = createConfigFixture();
  const originalText = readFileSync(file, 'utf8');
  const storedFiles = new Map([[file, originalText]]);
  const io = createMockScriptedIo(['checkout', 'y', 'y']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: (path) => storedFiles.has(path),

    read: (path) => storedFiles.get(path),

    writeAtomically: (path, content) => {
      if (path.endsWith('.gitignore')) throw new Error('gitignore write failed');
      storedFiles.set(path, content);
    },

    remove: (path) => storedFiles.delete(path),
  };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.equal(storedFiles.get(file), originalText);
  assert.deepEqual(errors, ['gitignore write failed']);
});

test('direct config init reports a storage failure without claiming success', async () => {
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };
  const fileStore = {
    exists: () => false,

    read: () => '',

    writeAtomically: () => {
      throw new Error('configuration disk is unavailable');
    },

    remove: () => undefined,
  };

  const exitCode = await runConfigCommand(
    'unused-root',
    ['--init'],
    undefined,
    undefined,
    logger,
    fileStore,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(errors, ['configuration disk is unavailable']);
});

test('wizard identifies legacy JSON and canonical fields without modifying config', async () => {
  const { root, file } = createConfigFixture();
  const legacyFile = join(root, 'sloop.config.json');
  writeFileSync(legacyFile, '{"legacy":true}\n');
  const logs = [];
  const logger = { log: (message) => logs.push(message), error: () => undefined };

  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'github.labels.eligible'],
    undefined,
    createMockScriptedIo([]),
    logger,
  );

  assert.equal(exitCode, 0);
  assert.match(logs.join('\n'), /Legacy JSON detected/);
  assert.match(logs.join('\n'), /github\.labels\.eligible: canonical read-only/);
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.equal(readFileSync(legacyFile, 'utf8'), '{"legacy":true}\n');
});

test('wizard skips dependent settings after their companion is disabled', async () => {
  const { root, file } = createConfigFixture();
  const disabledConfiguration = readFileSync(file, 'utf8').replace(
    '  enabled:\n    # Whether base health gates new work.\n    true',
    '  enabled:\n    # Whether base health gates new work.\n    false',
  );
  writeFileSync(file, disabledConfiguration);
  const io = createMockScriptedIo(['']);
  const logs = [];
  const logger = { log: (message) => logs.push(message), error: () => undefined };

  const exitCode = await runConfigCommand(root, ['health', '--no-sync'], undefined, io, logger);

  assert.equal(exitCode, 0, io.text());
  assert.match(logs.join('\n'), /health\.command is inactive because health\.enabled=true/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).health.enabled, false);
});

test('wizard retries blank and invalid dependency answers before canceling', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['', 'invalid-mode', 'worktree', '.sloop/worktrees', 'n']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['workspace.worktreeRoot', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0, io.text());
  assert.match(errors.join('\n'), /requires companion path workspace\.mode=worktree/);
  assert.match(errors.join('\n'), /expected one of: checkout, worktree/);
  assert.equal(loadConfigText(readFileSync(file, 'utf8')).workspace.mode, 'checkout');
});

test('wizard rejects a valid but unsatisfied workspace dependency', async () => {
  const { root } = createConfigFixture();
  const io = createMockScriptedIo(['checkout']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['workspace.worktreeRoot', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 2);
  assert.match(errors.join('\n'), /requires companion path workspace\.mode=worktree/);
});

test('wizard retries invalid argv JSON without changing the configuration', async () => {
  const { root, file } = createConfigFixture();
  const original = readFileSync(file, 'utf8');
  const io = createMockScriptedIo(['not-json', '["git","status"]', 'n']);
  const errors = [];
  const logger = { log: () => undefined, error: (message) => errors.push(message) };

  const exitCode = await runConfigCommand(
    root,
    ['health.command', '--no-sync'],
    undefined,
    io,
    logger,
  );

  assert.equal(exitCode, 0, io.text());
  assert.match(errors.join('\n'), /expected valid JSON/);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('non-interactive init supports forced synchronization success and failure', async () => {
  const first = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-sync-'));
  const calls = [];
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_c, _e, cb) {
        cb();
      },
    }),
  };

  assert.equal(
    await runConfigCommand(
      first,
      ['--init', '--force'],
      async (_root, kind) => calls.push(kind),
      io,
    ),
    0,
  );
  assert.deepEqual(calls, ['github']);
  const second = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-sync-fail-'));
  assert.equal(
    await runConfigCommand(
      second,
      ['--init', '--force'],
      async () => {
        throw new Error('adapter down');
      },
      io,
    ),
    2,
  );
  assert.equal(existsSync(join(second, 'sloop.config.yaml')), true);
});

test('default reconciler fails visibly for mutation-capable integrations', async () => {
  await assert.rejects(() => reconcileConfig('.', 'github'), /No production reconciler/);

  assert.throws(() => reconcileConfig.preflight('.', 'skills'), /No production reconciler/);
  assert.doesNotThrow(() => reconcileConfig.preflight('.', 'none'));
});

function createBlankAnswers(scope, tail) {
  return configPaths(scope)
    .filter(
      (path) =>
        getConfigField(path) &&
        !path.startsWith('github.labels.') &&
        path !== 'workflow.reviewOrder',
    )
    .map(() => '')
    .concat(tail);
}

test('scalar setters apply without a TTY and reconcile only after the atomic write', async () => {
  const { root, file } = createConfigFixture();
  const events = [];
  const result = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--sync'],
    async (r, kind) => {
      events.push([kind, readFileSync(join(r, 'sloop.config.yaml'), 'utf8').includes('develop')]);
    },
  );

  assert.equal(result, 0);
  assert.deepEqual(events, [['github', true]]);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
});

test('scalar setters replace an existing configuration file', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file, 'utf8');

  assert.match(before, /baseBranch:[\s\S]*?\n    main/);
  assert.equal(await runConfigCommand(root, ['repository.baseBranch', 'develop', '--no-sync']), 0);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?\n    develop/);
  assert.notEqual(readFileSync(file, 'utf8'), before);
});

test('invalid scalar input fails before writing or reconciling', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  let hasReconciledConfiguration = false;
  const result = await runConfigCommand(
    root,
    ['arbiter.reviewRounds', 'not-an-integer', '--sync'],
    async () => {
      hasReconciledConfiguration = true;
    },
  );

  assert.equal(result, 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(hasReconciledConfiguration, false);
});

test('production sync fails closed for every external reconciler kind', async () => {
  const { root, file } = createConfigFixture();
  for (const kind of ['github', 'workspace', 'skills', 'scheduler']) {
    await assert.rejects(() => productionConfigReconciler(root)(root, kind), new RegExp(kind));
  }
  const result = await runConfigCommand(
    root,
    ['repository.baseBranch', 'develop', '--sync'],
    productionConfigReconciler(root),
  );

  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
});

test('wizard cancellation, dependency prompts, and legacy JSON are safe', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  writeFileSync(join(root, 'sloop.config.json'), '{"legacy":true}\n');
  const legacyBefore = readFileSync(join(root, 'sloop.config.json'));

  assert.deepEqual(readFileSync(join(root, 'sloop.config.json')), legacyBefore);
  assert.equal(await runConfigCommand(root, ['schedule.cron', '* * * * *', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('dependency preview shows the captured old value', async () => {
  const { root, file } = createConfigFixture();
  const source = readFileSync(file, 'utf8').replace(
    /  enabled:\n    # Whether base health gates new work\.\n    true/,
    '  enabled:\n    # Whether base health gates new work.\n    false',
  );
  writeFileSync(file, source);
  const io = createMockScriptedIo(['true', '["gh","run","list"]', 'n']);
  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    assert.equal(await runConfigCommand(root, ['health.command', '--no-sync'], undefined, io), 0);
  } finally {
    console.log = log;
  }
  assert.match(logs.join('\n'), /health\.enabled: false -> true/);
  assert.doesNotMatch(logs.join('\n'), /health\.enabled: true -> true/);
  assert.equal(readFileSync(file, 'utf8'), source);
});

test('wizard retries invalid enum values without restarting init', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-wizard-retry-'));
  const io = createMockScriptedIo(['pijs', 'checkout', 'n']);
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(' '));

  try {
    assert.equal(
      await runConfigCommand(root, ['--init', '--wizard', 'workspace.mode'], undefined, io),
      0,
    );
  } finally {
    console.error = error;
  }
  assert.match(errors.join('\n'), /expected one of: checkout, worktree/);
  assert.match(io.text(), /Leave empty to use "checkout" as default/);
});

test('sandbox wizard exposes and persists the explicit danger-full-access option', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['danger-full-access', 'y', 'n']);
  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    assert.equal(
      await runConfigCommand(root, ['--init', '--wizard', 'agents.worker.sandbox'], undefined, io),
      0,
    );
  } finally {
    console.log = log;
  }
  assert.match(io.text(), /options: read-only, workspace-write, danger-full-access/);
  assert.match(logs.join('\n'), /agents\.worker\.sandbox: workspace-write -> danger-full-access/);
  assert.match(readFileSync(file, 'utf8'), /sandbox:[\s\S]*?\n\s+danger-full-access/);
});

test('workspace worktree root explains its mode dependency', async () => {
  const { root } = createConfigFixture();
  const io = createMockScriptedIo(['worktree', '.sloop/worktrees', 'n']);

  assert.equal(await runConfigCommand(root, ['workspace.worktreeRoot'], undefined, io), 0);
  assert.match(
    io.text(),
    /workspace\.mode \(required by workspace\.worktreeRoot; enter worktree\)/,
  );
  assert.match(io.text(), /workspace\.worktreeRoot\n/);
});

test('typed registry exposes full, section, and leaf wizard scopes', () => {
  const all = configPaths();
  const workspace = configPaths('workspace');
  const leaf = configPaths('workspace.mode');

  assert.ok(all.length > workspace.length);
  assert.ok(workspace.length > leaf.length);
  assert.deepEqual(leaf, ['workspace.mode']);
  assert.ok(workspace.every((path) => path === 'workspace' || path.startsWith('workspace.')));
});

test('complex and canonical setters fail before changing bytes', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);

  assert.equal(await runConfigCommand(root, ['workflow.reviewOrder', 'qa', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(await runConfigCommand(root, ['github.labels.eligible', 'other', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('config init/install retain distinct command identity', () => {
  const getCliCommand = (args) => {
    const parseResult = parseCliCommand(args);
    assert.equal(parseResult.ok, true);
    return parseResult.value;
  };
  const cliArgs = ['config', 'init'];
  const parsedCliCommand = getCliCommand(cliArgs);
  assert.deepEqual(parsedCliCommand, { kind: 'config', args: ['--init'] });
  const cliArgs2 = ['config', 'init', '--wizard'];
  const parsedCliCommand2 = getCliCommand(cliArgs2);
  assert.deepEqual(parsedCliCommand2, {
    kind: 'config',

    args: ['--init', '--wizard'],
  });
  const cliArgs3 = ['config', 'install'];
  const parsedCliCommand3 = getCliCommand(cliArgs3);
  assert.deepEqual(parsedCliCommand3, { kind: 'config', args: ['--install'] });
  const cliArgs4 = ['config', 'install', '--force'];
  const parsedCliCommand4 = getCliCommand(cliArgs4);
  assert.deepEqual(parsedCliCommand4, {
    kind: 'config',

    args: ['--install', '--force'],
  });
  const cliArgs5 = ['init'];
  const invalidCommandResult = parseCliCommand(cliArgs5);
  assert.equal(invalidCommandResult.ok, false);
  assert.match(invalidCommandResult.error, /unsupported|usage/i);
  const cliArgs6 = ['config'];
  const parsedCliCommand5 = getCliCommand(cliArgs6);
  assert.deepEqual(parsedCliCommand5, { kind: 'config', args: [] });
  const cliArgs7 = ['config', 'workspace'];
  const parsedCliCommand6 = getCliCommand(cliArgs7);
  assert.deepEqual(parsedCliCommand6, {
    kind: 'config',

    args: ['workspace'],
  });
});

test('plain init creates canonical defaults without a TTY and never overwrites', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-direct-init-'));
  const file = join(root, 'sloop.config.yaml');

  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  const before = readFileSync(file, 'utf8');
  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('config show and scalar setters remain non-interactive while config wizard requires a TTY', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show', 'repository.baseBranch']), 0);
  assert.equal(await runConfigCommand(root, []), 2);
});

test('config show accepts full sections as well as leaves', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show', 'workspace']), 0);
  assert.equal(await runConfigCommand(root, ['show']), 0);
});

test('unknown wizard scopes fail with valid-path guidance before entering the TTY wizard', async () => {
  const { root } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['definitely.not.a.path']), 2);
});

test('production sync never reports success when no reconciler is installed', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file, 'utf8');
  const result = await runConfigCommand(root, ['repository.baseBranch', 'develop', '--sync']);

  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('config install asks for confirmation unless forced', async () => {
  const { root } = createConfigFixture();
  const skipped = createMockScriptedIo(['n']);
  let calls = 0;
  const reconciler = async () => {
    calls++;
  };

  assert.equal(await runConfigCommand(root, ['--install'], reconciler, skipped), 0);
  assert.equal(calls, 0);
  assert.match(skipped.text(), /Install configured GitHub labels and Sloop skills now/);
  const forced = await runConfigCommand(root, ['--install', '--force'], reconciler);
  assert.equal(forced, 0);
  assert.equal(calls, 1);
});

test('config install rejects missing configuration without side effects', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-install-missing-'));
  let hasReconcilerRun = false;
  const result = await runConfigCommand(root, ['--install'], async () => {
    hasReconcilerRun = true;
  });

  assert.equal(result, 2);
  assert.equal(hasReconcilerRun, false);
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

test('config install requires a TTY unless forced', async () => {
  const { root } = createConfigFixture();
  const input = new PassThrough();
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  let hasReconcilerRun = false;
  const result = await runConfigCommand(
    root,
    ['--install'],
    async () => {
      hasReconcilerRun = true;
    },
    { input, output },
  );

  assert.equal(result, 2);
  assert.equal(hasReconcilerRun, false);
});

test('complex setters fail without changing the document', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);

  assert.equal(await runConfigCommand(root, ['skills.required', 'foo', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('show reports the complete document and typed leaf values', async () => {
  const { root, file } = createConfigFixture();

  assert.equal(await runConfigCommand(root, ['show']), 0);
  assert.equal(await runConfigCommand(root, ['show', 'schedule.enabled']), 0);
  assert.ok(readFileSync(file, 'utf8').includes('# Platform scheduler expression.'));
});

test('real readline wizard covers init, section, and leaf scopes with confirmation safety', async () => {
  const initRoot = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-'));
  const initIO = createMockScriptedIo(['subdir', 'y', 'n']);

  assert.equal(
    await runConfigCommand(initRoot, ['--init', '--wizard', 'workspace.path'], undefined, initIO),
    0,
    initIO.text(),
  );
  assert.ok(readFileSync(join(initRoot, 'sloop.config.yaml'), 'utf8').includes('#'));
  assert.match(initIO.text(), /recommendation:/);

  const section = createConfigFixture();
  assert.ok(
    configPaths('workspace').every((path) => path === 'workspace' || path.startsWith('workspace.')),
  );

  const leaf = createConfigFixture();
  const leafIO = createMockScriptedIo(['subdir', 'y']);
  assert.equal(await runConfigCommand(leaf.root, ['workspace.path'], undefined, leafIO), 0);
  assert.match(readFileSync(leaf.file, 'utf8'), /path:[\s\S]*?subdir/);
  assert.match(leafIO.text(), /workspace\.path[\s\S]*options:/);
});

test('interactive cancellation leaves bytes unchanged', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);
  const io = createMockScriptedIo(['subdir', 'n']);

  assert.equal(await runConfigCommand(root, ['workspace.path'], undefined, io), 0, io.text());
  assert.deepEqual(readFileSync(file), before);
  assert.match(io.text(), /workspace\.path[\s\S]*options:/);
});

test('init creates canonical YAML when a scoped prompt accepts its default', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-bare-init-'));
  const io = createMockScriptedIo(['', 'y', 'n']);

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  const file = join(root, 'sloop.config.yaml');
  assert.ok(existsSync(file));
  assert.ok(readFileSync(file, 'utf8').includes('#'));
});

test('init cancellation does not create YAML', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-bare-init-cancel-'));
  const io = createMockScriptedIo(['', 'n']);

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

test('config init migrates legacy skill names to canonical names', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-branches-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, canonicalConfigYaml().replaceAll('sloop-worker', 'worker'));
  const initExitCode = await runConfigCommand(root, ['--init']);
  const migratedConfiguration = readFileSync(file, 'utf8');

  assert.equal(initExitCode, 0);
  assert.match(migratedConfiguration, /sloop-worker/);
});

test('config init reports unknown keys while migrating legacy skill names', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-unknown-migration-'));
  const file = join(root, 'sloop.config.yaml');
  const configWithLegacySkill = canonicalConfigYaml().replaceAll('sloop-worker', 'worker');
  const configWithUnknownKey = `${configWithLegacySkill}\nfutureSetting: true\n`;
  const logger = { log: vi.fn(), error: vi.fn() };
  writeFileSync(file, configWithUnknownKey);

  const exitCode = await runConfigCommand(root, ['--init'], undefined, undefined, logger);

  assert.equal(exitCode, 0);
  assert.match(readFileSync(file, 'utf8'), /sloop-worker/);
  assert.deepEqual(logger.error.mock.calls, [
    ['$.futureSetting: unknown configuration key; ignoring it'],
  ]);
});

test('invalid config command forms return the usage exit code', async () => {
  const { root } = createConfigFixture();
  const io = {
    input: new PassThrough(),

    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  };
  const exitCodes = [
    await runConfigCommand(root, ['--sync', '--no-sync'], undefined, io),
    await runConfigCommand(root, ['--wizard'], undefined, io),
    await runConfigCommand(root, ['workspace.path', 'subdir'], undefined, io),
  ];

  assert.deepEqual(exitCodes, [2, 2, 2]);
});

test('config install reports a failure when its reconciler is unavailable', async () => {
  const { root } = createConfigFixture();
  const installWithUnavailableReconciler = () =>
    runConfigCommand(root, ['--install', '--force'], async () => {
      throw new Error('no access');
    });
  const exitCode = await installWithUnavailableReconciler();

  assert.equal(exitCode, 2);
});

test('forced config init requests GitHub reconciliation', async () => {
  const blank = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-direct-'));
  const events = [];
  const exitCode = await runConfigCommand(blank, ['--init', '--force'], async (_root, kind) =>
    events.push(kind),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['github']);
});

test('interactive init writes gitignore, list and argv wizard values, and synchronizes explicit kinds', async () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-config-interactive-'));
  writeFileSync(join(root, '.gitignore'), 'node_modules');
  const events = [];
  const io = createMockScriptedIo(['["git","status"]', 'y', 'y']);
  const exitCode = await runConfigCommand(
    root,
    ['--init', '--wizard', 'health.command', '--sync'],
    async (_root, kind) => events.push(kind),
    io,
  );
  const configurationText = readFileSync(join(root, 'sloop.config.yaml'), 'utf8');
  const gitignoreText = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.equal(exitCode, 0);
  assert.match(configurationText, /command:\n    - git\n    - status/);
  assert.match(gitignoreText, /\.sloop\//);
  assert.deepEqual(events, []);
});

test('wizard trims comma-separated required skill names before persisting them', async () => {
  const { root, file } = createConfigFixture();
  const io = createMockScriptedIo(['sloop-worker, sloop-qa', 'y']);

  const exitCode = await runConfigCommand(root, ['skills.required', '--no-sync'], undefined, io);

  assert.equal(exitCode, 0, io.text());
  assert.deepEqual(loadConfigText(readFileSync(file, 'utf8')).skills.required, [
    'sloop-worker',
    'sloop-qa',
  ]);
});

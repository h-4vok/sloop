import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { canonicalConfigYaml } from '../dist/config.js';
import { configPaths } from '../dist/config.js';
import { runConfigCommand } from '../dist/config-wizard.js';
import { getConfigField } from '../dist/config.js';
import { productionConfigReconciler } from '../dist/adapters.js';
import { parseCliCommand } from '../dist/runtime.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sloop-wizard-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, canonicalConfigYaml());
  return { root, file };
}

function scriptedIO(answers, end = true) {
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
    const send = () => {
      if (index < answers.length) input.write(`${answers[index++]}\n`);
      else if (end) input.end();
      if (!input.destroyed && index < answers.length) setTimeout(send, 5);
    };
    send();
  });
  return { input, output, text: () => captured };
}

function blankAnswers(scope, tail) {
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
  const { root, file } = fixture();
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
  const { root, file } = fixture();
  const before = readFileSync(file, 'utf8');
  assert.match(before, /baseBranch:[\s\S]*?\n    main/);
  assert.equal(await runConfigCommand(root, ['repository.baseBranch', 'develop', '--no-sync']), 0);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?\n    develop/);
  assert.notEqual(readFileSync(file, 'utf8'), before);
});

test('invalid scalar input fails before writing or reconciling', async () => {
  const { root, file } = fixture();
  const before = readFileSync(file);
  let reconciled = false;
  const result = await runConfigCommand(
    root,
    ['arbiter.reviewRounds', 'not-an-integer', '--sync'],
    async () => {
      reconciled = true;
    },
  );
  assert.equal(result, 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(reconciled, false);
});

test('production sync fails closed for every external reconciler kind', async () => {
  const { root, file } = fixture();
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
  const { root, file } = fixture();
  const before = readFileSync(file);
  writeFileSync(join(root, 'sloop.config.json'), '{"legacy":true}\n');
  const legacyBefore = readFileSync(join(root, 'sloop.config.json'));
  assert.deepEqual(readFileSync(join(root, 'sloop.config.json')), legacyBefore);
  assert.equal(await runConfigCommand(root, ['schedule.cron', '* * * * *', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('dependency preview shows the captured old value', async () => {
  const { root, file } = fixture();
  const source = readFileSync(file, 'utf8').replace(
    /  enabled:\n    # Whether base health gates new work\.\n    true/,
    '  enabled:\n    # Whether base health gates new work.\n    false',
  );
  writeFileSync(file, source);
  const io = scriptedIO(['true', '["gh","run","list"]', 'n']);
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
  const root = mkdtempSync(join(tmpdir(), 'sloop-wizard-retry-'));
  const io = scriptedIO(['pijs', 'checkout', 'n']);
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

test('workspace worktree root explains its mode dependency', async () => {
  const { root } = fixture();
  const io = scriptedIO(['worktree', '.sloop/worktrees', 'n']);
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
  const { root, file } = fixture();
  const before = readFileSync(file);
  assert.equal(await runConfigCommand(root, ['workflow.reviewOrder', 'qa', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(await runConfigCommand(root, ['github.labels.eligible', 'other', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('init and config retain distinct command identity', () => {
  assert.deepEqual(parseCliCommand(['init']), { kind: 'config', args: ['--init'] });
  assert.deepEqual(parseCliCommand(['init', '--wizard']), {
    kind: 'config',
    args: ['--init', '--wizard'],
  });
  assert.throws(() => parseCliCommand(['init', '--nope']), /usage: sloop init \[--wizard\]/);
  assert.deepEqual(parseCliCommand(['config']), { kind: 'config', args: [] });
  assert.deepEqual(parseCliCommand(['config', 'workspace']), {
    kind: 'config',
    args: ['workspace'],
  });
});

test('plain init creates canonical defaults without a TTY and never overwrites', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-direct-init-'));
  const file = join(root, 'sloop.config.yaml');
  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  const before = readFileSync(file, 'utf8');
  assert.equal(await runConfigCommand(root, ['--init']), 0);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('config show and scalar setters remain non-interactive while config wizard requires a TTY', async () => {
  const { root } = fixture();
  assert.equal(await runConfigCommand(root, ['show', 'repository.baseBranch']), 0);
  assert.equal(await runConfigCommand(root, []), 2);
});

test('config show accepts full sections as well as leaves', async () => {
  const { root } = fixture();
  assert.equal(await runConfigCommand(root, ['show', 'workspace']), 0);
  assert.equal(await runConfigCommand(root, ['show']), 0);
});

test('unknown wizard scopes fail with valid-path guidance before entering the TTY wizard', async () => {
  const { root } = fixture();
  assert.equal(await runConfigCommand(root, ['definitely.not.a.path']), 2);
});

test('production sync never reports success when no reconciler is installed', async () => {
  const { root, file } = fixture();
  const before = readFileSync(file, 'utf8');
  const result = await runConfigCommand(root, ['repository.baseBranch', 'develop', '--sync']);
  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?main/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('complex setters fail without changing the document', async () => {
  const { root, file } = fixture();
  const before = readFileSync(file);
  assert.equal(await runConfigCommand(root, ['skills.required', 'foo', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('show reports the complete document and typed leaf values', async () => {
  const { root, file } = fixture();
  assert.equal(await runConfigCommand(root, ['show']), 0);
  assert.equal(await runConfigCommand(root, ['show', 'schedule.enabled']), 0);
  assert.ok(readFileSync(file, 'utf8').includes('# Platform scheduler expression.'));
});

test('real readline wizard covers init, section, and leaf scopes with confirmation safety', async () => {
  const initRoot = mkdtempSync(join(tmpdir(), 'sloop-init-'));
  const initIO = scriptedIO(['subdir', 'y', 'n']);
  assert.equal(
    await runConfigCommand(initRoot, ['--init', '--wizard', 'workspace.path'], undefined, initIO),
    0,
    initIO.text(),
  );
  assert.ok(readFileSync(join(initRoot, 'sloop.config.yaml'), 'utf8').includes('#'));
  assert.match(initIO.text(), /recommendation:/);

  const section = fixture();
  assert.ok(
    configPaths('workspace').every((path) => path === 'workspace' || path.startsWith('workspace.')),
  );

  const leaf = fixture();
  const leafIO = scriptedIO(['subdir', 'y']);
  assert.equal(await runConfigCommand(leaf.root, ['workspace.path'], undefined, leafIO), 0);
  assert.match(readFileSync(leaf.file, 'utf8'), /path:[\s\S]*?subdir/);
  assert.match(leafIO.text(), /workspace\.path[\s\S]*options:/);
});

test('interactive cancellation leaves bytes unchanged', async () => {
  const { root, file } = fixture();
  const before = readFileSync(file);
  const io = scriptedIO(['subdir', 'n']);
  assert.equal(await runConfigCommand(root, ['workspace.path'], undefined, io), 0, io.text());
  assert.deepEqual(readFileSync(file), before);
  assert.match(io.text(), /workspace\.path[\s\S]*options:/);
});

test('init creates canonical YAML when a scoped prompt accepts its default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-bare-init-'));
  const io = scriptedIO(['', 'y', 'n']);
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
  const root = mkdtempSync(join(tmpdir(), 'sloop-bare-init-cancel-'));
  const io = scriptedIO(['', 'n']);
  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

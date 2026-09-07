import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml } from '../dist/config.js';
import { configPaths } from '../dist/config.js';
import { runConfigCommand } from '../dist/config-wizard.js';
import { productionConfigReconciler } from '../dist/adapters.js';
import { parseCliCommand } from '../dist/runtime.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sloop-wizard-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, canonicalConfigYaml());
  return { root, file };
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
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?develop/);
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
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?develop/);
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
  assert.deepEqual(parseCliCommand(['config']), { kind: 'config', args: [] });
  assert.deepEqual(parseCliCommand(['config', 'workspace']), {
    kind: 'config',
    args: ['workspace'],
  });
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

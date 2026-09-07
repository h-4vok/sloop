import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml } from '../dist/config.js';
import { runConfigCommand } from '../dist/config-wizard.js';
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

test('unknown wizard scopes fail with valid-path guidance before entering the TTY wizard', async () => {
  const { root } = fixture();
  assert.equal(await runConfigCommand(root, ['definitely.not.a.path']), 2);
});

test('production sync never reports success when no reconciler is installed', async () => {
  const { root, file } = fixture();
  const before = readFileSync(file, 'utf8');
  const result = await runConfigCommand(root, ['repository.baseBranch', 'develop', '--sync']);
  assert.equal(result, 2);
  assert.match(readFileSync(file, 'utf8'), /baseBranch:[\s\S]*?develop/);
  assert.notEqual(readFileSync(file, 'utf8'), before);
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

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalConfigYaml, loadConfigText } from '../../src/config.js';
import { migrateSkillNames, syncPrerequisites } from '../../src/sync.js';
import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import { createSyncFixture } from '../support/sync-fixture.mjs';

test('sync installs each distributed Sloop skill', () => {
  const { root, runner, config } = createSyncFixture();

  syncPrerequisites(root, config, { runner });

  for (const name of [
    'product-lead',
    'sloop-worker',
    'sloop-qa',
    'sloop-test-cleanup',
    'sloop-e2e-prepare',
    'sloop-test-empty-e2e',
  ])
    assert.equal(existsSync(join(root, '.codex', 'skills', name, 'SKILL.md')), true);
});

test('sync replaces an official skill and preserves unrelated skills', () => {
  const { root, runner, config } = createSyncFixture();
  mkdirSync(join(root, '.codex', 'skills', 'sloop-worker'), { recursive: true });
  mkdirSync(join(root, '.codex', 'skills', 'custom'), { recursive: true });
  writeFileSync(join(root, '.codex', 'skills', 'sloop-worker', 'SKILL.md'), 'old');
  writeFileSync(join(root, '.codex', 'skills', 'custom', 'SKILL.md'), 'keep');

  syncPrerequisites(root, config, { runner });

  assert.match(
    readFileSync(join(root, '.codex', 'skills', 'sloop-worker', 'SKILL.md'), 'utf8'),
    /sloop-worker/,
  );
  assert.equal(readFileSync(join(root, '.codex', 'skills', 'custom', 'SKILL.md'), 'utf8'), 'keep');
});

test('sync migrates legacy skill names in configuration text', () => {
  const text = canonicalConfigYaml()
    .replaceAll('sloop-worker', 'worker')
    .replaceAll('sloop-qa', 'qa-sdet');

  const migratedText = migrateSkillNames(text);

  assert.match(migratedText, /sloop-worker/);
});

test('sync rejects legacy skill names until config init runs', () => {
  const text = canonicalConfigYaml()
    .replaceAll('sloop-worker', 'worker')
    .replaceAll('sloop-qa', 'qa-sdet');
  const config = loadConfigText(text);
  const syncLegacyConfig = () =>
    syncPrerequisites(createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-sync-')), config, {
      runner: () => '',
    });

  assert.throws(syncLegacyConfig, /run sloop config init/);
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
    'sloop-test-empty-e2e',
  ])
    assert.equal(existsSync(join(root, '.codex', 'skills', name, 'SKILL.md')), true);
});

test('sync removes the obsolete one-cycle skill and preserves other skill files', () => {
  const { root, runner, config } = createSyncFixture();
  const obsoleteSkill = join(root, '.codex', 'skills', 'sloop-e2e-prepare');
  mkdirSync(obsoleteSkill, { recursive: true });
  writeFileSync(join(obsoleteSkill, 'SKILL.md'), 'obsolete one-cycle skill');
  writeFileSync(join(obsoleteSkill, 'notes.md'), 'keep unrelated content');

  syncPrerequisites(root, config, { runner });

  assert.equal(existsSync(join(obsoleteSkill, 'SKILL.md')), false);
  assert.equal(readFileSync(join(obsoleteSkill, 'notes.md'), 'utf8'), 'keep unrelated content');
});

test('sync preserves obsolete skill files behind a linked directory', () => {
  const { root, runner, config } = createSyncFixture();
  const externalSkills = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-external-skills-'));
  const obsoleteSkill = join(root, '.codex', 'skills', 'sloop-e2e-prepare');
  const externalSkillFile = join(externalSkills, 'SKILL.md');
  const externalSkillContents = 'shared skill file';
  mkdirSync(join(root, '.codex', 'skills'), { recursive: true });
  writeFileSync(externalSkillFile, externalSkillContents);
  symlinkSync(externalSkills, obsoleteSkill, process.platform === 'win32' ? 'junction' : 'dir');

  syncPrerequisites(root, config, { runner });

  assert.equal(lstatSync(obsoleteSkill).isSymbolicLink(), true);
  assert.equal(readFileSync(externalSkillFile, 'utf8'), externalSkillContents);
});

test('sync preserves obsolete skill files behind a linked ancestor', () => {
  const { root, runner, config } = createSyncFixture();
  const externalRoot = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-external-codex-'));
  const externalCodexDirectory = join(externalRoot, '.codex');
  const externalSkillDirectory = join(externalCodexDirectory, 'skills', 'sloop-e2e-prepare');
  const linkedCodexDirectory = join(root, '.codex');
  const externalSkillFile = join(externalSkillDirectory, 'SKILL.md');
  const externalSkillContents = 'shared ancestor skill file';
  mkdirSync(externalSkillDirectory, { recursive: true });
  writeFileSync(externalSkillFile, externalSkillContents);
  symlinkSync(
    externalCodexDirectory,
    linkedCodexDirectory,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  syncPrerequisites(root, config, { runner });

  assert.equal(lstatSync(linkedCodexDirectory).isSymbolicLink(), true);
  assert.equal(readFileSync(externalSkillFile, 'utf8'), externalSkillContents);
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

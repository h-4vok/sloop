import { createIsolatedTemporaryDirectory } from './support/temporary-directory.mjs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml, loadConfigText } from '../src/config.js';
import { syncPrerequisites, migrateSkillNames } from '../src/sync.js';

function createSyncFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-sync-'));
  writeFileSync(join(root, 'sloop.config.yaml'), canonicalConfigYaml());
  const calls = [];
  const runner = (file, args) => {
    calls.push([file, [...args]]);
    if (file === 'git') return 'https://github.com/example/repo.git';
    if (args[0] === 'label' && args[1] === 'list') return '[]';
    return '';
  };
  return { root, calls, runner, config: loadConfigText(canonicalConfigYaml()) };
}

test('sync creates canonical GitHub labels', () => {
  const { root, calls, runner, config } = createSyncFixture();

  syncPrerequisites(root, config, { runner });

  assert.equal(calls.filter(([file, args]) => file === 'gh' && args[1] === 'create').length, 6);
});

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

test('sync does not recreate labels that already exist', () => {
  const { root, config } = createSyncFixture();
  const calls = [];
  syncPrerequisites(root, config, {
    runner: (file, args) => {
      calls.push([file, args]);
      return file === 'git'
        ? 'https://github.com/example/repo'
        : args[1] === 'list'
          ? JSON.stringify([{ name: args[args.indexOf('--search') + 1] }])
          : '';
    },
  });

  const createLabelCalls = calls.filter(([file, args]) => file === 'gh' && args[1] === 'create');

  assert.equal(createLabelCalls.length, 0);
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

test('sync stops at the first label creation error', () => {
  const { root, config } = createSyncFixture();
  let createAttempts = 0;
  const runGitHubCommand = (file, args) => {
    if (file === 'git') return 'https://github.com/example/repo';
    if (args[1] === 'list') {
      const name = args[args.indexOf('--search') + 1];
      return name === 'Automation Ready'
        ? JSON.stringify([{ name, color: 'abc123', description: 'custom' }])
        : '[]';
    }
    createAttempts++;
    if (args[1] === 'create') throw new Error('permission denied');
    return '';
  };
  const syncLabels = () => syncPrerequisites(root, config, { runner: runGitHubCommand });

  assert.throws(syncLabels, /permission denied/);
  assert.equal(createAttempts, 1);
  assert.equal(existsSync(join(root, '.codex', 'skills')), false);
});

test('sync accepts repository-scoped skill configuration', () => {
  const { root, config, runner } = createSyncFixture();
  const repositoryScopedConfig = { ...config, skills: { ...config.skills, scope: 'repository' } };
  const syncWithRepositoryScope = () => syncPrerequisites(root, repositoryScopedConfig, { runner });

  assert.doesNotThrow(syncWithRepositoryScope);
});

test('sync rejects a remote outside GitHub', () => {
  const { root, config } = createSyncFixture();
  const syncWithExternalRemote = () =>
    syncPrerequisites(root, config, { runner: () => 'https://example.test/repo' });

  assert.throws(syncWithExternalRemote, /not a GitHub repository/);
});

test('sync omits custom label keys from canonical output', () => {
  const { root, config } = createSyncFixture();
  const outputMessages = [];
  const custom = {
    ...config,
    github: { ...config.github, labels: { ...config.github.labels, priority: ['custom'] } },
  };
  const syncWithInjectedOutput = () =>
    syncPrerequisites(root, custom, {
      runner: (file) => (file === 'git' ? 'git@github.com:owner/repo.git' : ''),
      output: (message) => outputMessages.push(message),
    });

  syncWithInjectedOutput();

  assert.ok(
    outputMessages.some((message) => message.includes('Synchronized 4 labels and 6 Sloop skills')),
  );
  assert.ok(!outputMessages.some((message) => message.includes("Label 'custom' installed")));
});

test('sync skips creation for an existing label', () => {
  const { root, config } = createSyncFixture();
  const outputMessages = [];
  const syncWithExistingLabel = () =>
    syncPrerequisites(root, config, {
      runner: (file, args) => {
        if (file === 'git') return 'https://github.com/example/repo';
        if (args[1] === 'list') {
          const name = args[args.indexOf('--search') + 1];
          return name === 'Automation Ready' ? JSON.stringify([{ name }]) : '[]';
        }
        return '';
      },
      output: (message) => outputMessages.push(message),
    });

  syncWithExistingLabel();

  assert.ok(outputMessages.some((message) => message.includes('already exists')));
});

test('sync rejects malformed label JSON', () => {
  const { root, config } = createSyncFixture();
  const syncWithMalformedLabel = () =>
    syncPrerequisites(root, config, {
      runner: (file, args) =>
        file === 'git' ? 'https://github.com/example/repo' : args[1] === 'list' ? '{' : '',
    });

  assert.throws(syncWithMalformedLabel, /Unexpected end|JSON/);
});

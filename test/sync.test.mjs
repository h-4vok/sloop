import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalConfigYaml, loadConfigText } from '../dist/config.js';
import { syncPrerequisites, migrateSkillNames } from '../dist/sync.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sloop-sync-'));
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

test('sync creates canonical labels and all distributed skills', () => {
  const { root, calls, runner, config } = fixture();
  syncPrerequisites(root, config, { runner });
  assert.equal(calls.filter(([file, args]) => file === 'gh' && args[1] === 'create').length, 6);
  for (const name of ['sloop-dispatcher', 'sloop-worker', 'sloop-qa'])
    assert.equal(existsSync(join(root, '.codex', 'skills', name, 'SKILL.md')), true);
});

test('sync overwrites official skills but preserves unrelated skills and is idempotent for labels', () => {
  const { root, runner, config } = fixture();
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
  assert.equal(calls.filter(([file, args]) => file === 'gh' && args[1] === 'create').length, 0);
});

test('legacy names migrate and sync refuses them until init', () => {
  const text = canonicalConfigYaml()
    .replaceAll('sloop-dispatcher', 'dispatcher')
    .replaceAll('sloop-worker', 'worker')
    .replaceAll('sloop-qa', 'qa-sdet');
  assert.match(migrateSkillNames(text), /sloop-dispatcher/);
  const config = loadConfigText(text);
  assert.throws(
    () =>
      syncPrerequisites(mkdtempSync(join(tmpdir(), 'sloop-sync-')), config, { runner: () => '' }),
    /run sloop config init/,
  );
});

test('existing label metadata is preserved and partial failures leave earlier work intact', () => {
  const { root, config } = fixture();
  let creates = 0;
  const runner = (file, args) => {
    if (file === 'git') return 'https://github.com/example/repo';
    if (args[1] === 'list') {
      const name = args[args.indexOf('--search') + 1];
      return name === 'Automation Ready'
        ? JSON.stringify([{ name, color: 'abc123', description: 'custom' }])
        : '[]';
    }
    creates++;
    if (args[1] === 'create') throw new Error('permission denied');
    return '';
  };
  assert.throws(() => syncPrerequisites(root, config, { runner }), /permission denied/);
  assert.equal(creates, 1);
  assert.equal(existsSync(join(root, '.codex', 'skills')), false);
});

test('unsafe destination is rejected before filesystem effects', () => {
  const { root, config, runner } = fixture();
  const unsafe = { ...config, skills: { ...config.skills, scope: 'repository' } };
  assert.doesNotThrow(() => syncPrerequisites(root, unsafe, { runner }));
});

test('sync rejects non-GitHub remotes, skips noncanonical labels, and supports injected output', () => {
  const { root, config } = fixture();
  assert.throws(
    () => syncPrerequisites(root, config, { runner: () => 'https://example.test/repo' }),
    /not a GitHub repository/,
  );
  const output = [];
  const custom = {
    ...config,
    github: { ...config.github, labels: { ...config.github.labels, priority: ['custom'] } },
  };
  syncPrerequisites(root, custom, {
    runner: (file, args) =>
      file === 'git' ? 'git@github.com:owner/repo.git' : args[1] === 'list' ? '[]' : '',
    output: (message) => output.push(message),
  });
  assert.ok(output.some((message) => message.includes('Synchronized 4 labels')));
  assert.ok(!output.some((message) => message.includes("Label 'custom' installed")));
});

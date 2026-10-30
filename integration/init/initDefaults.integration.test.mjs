import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTemporaryDirectory } from '../../test/support/temporary-directory.mjs';
import { canonicalConfigYaml, loadConfigText } from '../../src/config.js';
import { runConfigCommand } from '../../src/config-wizard.js';
import {
  cleanupTemporaryRepos,
  createMockScriptedIo,
  createRepository,
  runSloopCli,
  trackTemporaryRepo,
} from '../support/init-fixtures.mjs';

afterEach(cleanupTemporaryRepos);

test('CLI discovery reports version, JSON status, exit classes, and safe failures', () => {
  const outside = trackTemporaryRepo(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-contracts-outside-')),
  );
  const help = runSloopCli(outside, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: sloop/);

  const version = runSloopCli(outside, ['--version']);
  assert.equal(version.status, 0);
  const packageVersion = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
  ).version;
  assert.equal(version.stdout.trim(), packageVersion);

  const unknown = runSloopCli(outside, ['--unknown']);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Command usage is invalid/);

  const json = runSloopCli(outside, ['status', '--json']);
  assert.equal(json.status, 2);
  assert.equal(json.stderr, '');
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.phase, 'discovery');
  assert.match(envelope.diagnostics[0].message, /Git repository/);
});

test('CLI config init writes canonical defaults without a TTY', () => {
  const root = createRepository();
  const result = runSloopCli(root, ['config', 'init']);

  assert.equal(result.status, 0, result.stderr);
  const file = join(root, 'sloop.config.yaml');
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.doesNotThrow(() => loadConfigText(readFileSync(file, 'utf8')));
});

test('CLI config init leaves an existing user config unchanged', () => {
  const root = createRepository();
  assert.equal(runSloopCli(root, ['config', 'init']).status, 0);
  const file = join(root, 'sloop.config.yaml');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, `${before}\n# user change\n`);

  const result = runSloopCli(root, ['config', 'init']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(file, 'utf8'), `${before}\n# user change\n`);
  assert.match(result.stdout, /already exists; leaving it unchanged/);
});

test('wizard accepts defaults and writes a valid canonical config', async () => {
  const root = createRepository();
  const io = createMockScriptedIo(['', 'y', 'n']);

  const result = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
  );

  assert.equal(result, 0, io.text());
  const file = join(root, 'sloop.config.yaml');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.doesNotThrow(() => loadConfigText(readFileSync(file, 'utf8')));
});

test('invalid init usage fails without creating a config', () => {
  const root = createRepository();
  const result = runSloopCli(root, ['config', 'init', '--unknown']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage|unsupported|unknown/i);
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

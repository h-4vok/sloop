import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigText } from '../../src/config.js';
import { runConfigCommand } from '../../src/config-wizard.js';
import {
  cleanupTemporaryRepos,
  createMockScriptedIo,
  createRepository,
} from '../support/init-fixtures.mjs';

afterEach(cleanupTemporaryRepos);

test('config command rejects invalid and cancelled edits without side effects', async () => {
  const root = createRepository();
  const file = join(root, 'sloop.config.yaml');
  assert.equal(await runConfigCommand(root, ['--init']), 0);
  const before = readFileSync(file);

  const invalid = await runConfigCommand(root, ['workspace.mode', 'not-a-mode']);
  assert.equal(invalid, 2);
  assert.deepEqual(readFileSync(file), before);

  const cancelled = createMockScriptedIo(['worktree', 'n']);
  const result = await runConfigCommand(root, ['workspace.mode'], undefined, cancelled);
  assert.equal(result, 0);
  assert.deepEqual(readFileSync(file), before);
  assert.match(cancelled.text(), /workspace\.mode/);
});

test('wizard retries invalid input and persists varied valid settings', async () => {
  const root = createRepository();
  const modeIO = createMockScriptedIo(['pijs', 'worktree', 'y', 'n']);
  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.mode'], undefined, modeIO),
    0,
    modeIO.text(),
  );

  const rootIO = createMockScriptedIo(['.tmp/worktrees', 'y']);
  assert.equal(
    await runConfigCommand(root, ['workspace.worktreeRoot'], undefined, rootIO),
    0,
    rootIO.text(),
  );
  const baseIO = createMockScriptedIo(['develop', 'y']);
  assert.equal(
    await runConfigCommand(root, ['repository.baseBranch'], undefined, baseIO),
    0,
    baseIO.text(),
  );
  const intervalIO = createMockScriptedIo(['1m', 'y']);
  assert.equal(
    await runConfigCommand(root, ['loop.interval'], undefined, intervalIO),
    0,
    intervalIO.text(),
  );

  const config = loadConfigText(readFileSync(join(root, 'sloop.config.yaml'), 'utf8'));
  assert.equal(config.repository.baseBranch, 'develop');
  assert.equal(config.workspace.mode, 'worktree');
  assert.equal(config.workspace.worktreeRoot, '.tmp/worktrees');
  assert.equal(config.loop.interval, 60_000);
  assert.equal((modeIO.text().match(/workspace\.mode\n/g) ?? []).length, 2);
});

test('wizard cancellation does not create a config', async () => {
  const root = createRepository();
  const io = createMockScriptedIo(['', 'n']);

  const result = await runConfigCommand(
    root,
    ['--init', '--wizard', 'workspace.path'],
    undefined,
    io,
  );

  assert.equal(result, 0, io.text());
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

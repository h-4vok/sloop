import { createIsolatedTemporaryDirectory } from '../test/support/temporary-directory.mjs';
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { canonicalConfigYaml, configPaths, getConfigField, loadConfigText } from '../src/config.js';
import { runConfigCommand } from '../src/config-wizard.js';

const repoRoot = join(import.meta.dirname, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const temporaryRepos = new Set();

afterEach(() => {
  for (const root of temporaryRepos) rmSync(root, { recursive: true, force: true });
  temporaryRepos.clear();
});

function createRepository() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-integration-'));
  temporaryRepos.add(root);
  writeFileSync(join(root, 'readme.md'), '# integration\n');
  runGitCommand(root, ['init', '-b', 'main']);
  runGitCommand(root, ['config', 'user.name', 'Sloop Integration Test']);
  runGitCommand(root, ['config', 'user.email', 'sloop-integration@example.test']);
  runGitCommand(root, ['add', 'readme.md']);
  runGitCommand(root, ['commit', '-m', 'test: seed integration repo']);
  return root;
}

function runGitCommand(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function runSloopCli(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function createMockScriptedIo(answers) {
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
      if (index < answers.length) {
        input.write(`${answers[index++]}\n`);
        setTimeout(sendAnswer, 2);
      } else input.end();
    };
    sendAnswer();
  });
  return { input, output, text: () => captured };
}

function createWizardAnswers(variant, confirmation) {
  const values = [];
  for (const path of configPaths()) {
    const field = getConfigField(path);
    if (
      !field ||
      path === 'workspace' ||
      path.startsWith('github.labels.') ||
      path === 'workflow.reviewOrder'
    )
      continue;
    if (path === 'repository.baseBranch') values.push(variant ? 'develop' : '');
    else if (path === 'workspace.mode') values.push(...(variant ? ['pijs', 'worktree'] : ['']));
    else if (path === 'workspace.path' && variant) continue;
    else if (path === 'workspace.worktreeRoot' && variant) values.push('.tmp/worktrees');
    else if (path === 'workflow.requiredChecks' && variant) values.push('ci,qa');
    else values.push('');
  }
  values.push(confirmation);
  return values;
}

test('CLI integration contracts preserve discovery, JSON, exit classes, and safe failures', () => {
  const outside = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-contracts-outside-'));
  temporaryRepos.add(outside);

  const help = runSloopCli(outside, ['--help']);

  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: sloop/);

  const version = runSloopCli(outside, ['--version']);
  assert.equal(version.status, 0);
  const packageVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
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

test('config integration contracts reject invalid and cancelled changes without side effects', async () => {
  const root = createRepository();
  const file = join(root, 'sloop.config.yaml');
  const init = await runConfigCommand(root, ['--init']);

  assert.equal(init, 0);
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

test('CLI config init creates a valid canonical default config without a TTY', () => {
  const root = createRepository();
  const result = runSloopCli(root, ['config', 'init']);

  assert.equal(result.status, 0, result.stderr);
  const file = join(root, 'sloop.config.yaml');
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.doesNotThrow(() => loadConfigText(readFileSync(file, 'utf8')));
});

test('CLI config init is idempotent and does not overwrite an existing config', () => {
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

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  const file = join(root, 'sloop.config.yaml');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.doesNotThrow(() => loadConfigText(readFileSync(file, 'utf8')));
});

test('wizard retries invalid input and persists varied valid answers', async () => {
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
  const checksIO = createMockScriptedIo(['1m', 'y']);
  assert.equal(
    await runConfigCommand(root, ['loop.interval'], undefined, checksIO),
    0,
    checksIO.text(),
  );
  const text = readFileSync(join(root, 'sloop.config.yaml'), 'utf8');
  const config = loadConfigText(text);
  assert.equal(config.repository.baseBranch, 'develop');
  assert.equal(config.workspace.mode, 'worktree');
  assert.equal(config.workspace.worktreeRoot, '.tmp/worktrees');
  assert.equal(config.loop.interval, 60_000);
  assert.equal((modeIO.text().match(/workspace\.mode\n/g) ?? []).length, 2);
}, 15_000);

test('wizard cancellation does not create a config', async () => {
  const root = createRepository();
  const io = createMockScriptedIo(['', 'n']);

  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

test('invalid init usage fails without creating a config', () => {
  const root = createRepository();
  const result = runSloopCli(root, ['config', 'init', '--unknown']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage|unsupported|unknown/i);
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

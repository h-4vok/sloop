import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import {
  canonicalConfigYaml,
  configPaths,
  getConfigField,
  loadConfigText,
} from '../dist/config.js';
import { runConfigCommand } from '../dist/config-wizard.js';

const repoRoot = join(import.meta.dirname, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const temporaryRepos = new Set();

afterEach(() => {
  for (const root of temporaryRepos) rmSync(root, { recursive: true, force: true });
  temporaryRepos.clear();
});

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sloop-init-integration-'));
  temporaryRepos.add(root);
  writeFileSync(join(root, 'readme.md'), '# integration\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Sloop Integration Test']);
  git(root, ['config', 'user.email', 'sloop-integration@example.test']);
  git(root, ['add', 'readme.md']);
  git(root, ['commit', '-m', 'test: seed integration repo']);
  return root;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function scriptedIO(answers) {
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
      if (index < answers.length) {
        input.write(`${answers[index++]}\n`);
        setTimeout(send, 2);
      } else input.end();
    };
    send();
  });
  return { input, output, text: () => captured };
}

function wizardAnswers(variant, confirmation) {
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

test('CLI init creates a valid canonical default config without a TTY', () => {
  const root = createRepo();
  const result = runCli(root, ['init']);
  assert.equal(result.status, 0, result.stderr);
  const file = join(root, 'sloop.config.yaml');
  assert.equal(readFileSync(file, 'utf8'), canonicalConfigYaml());
  assert.doesNotThrow(() => loadConfigText(readFileSync(file, 'utf8')));
});

test('CLI init is idempotent and does not overwrite an existing config', () => {
  const root = createRepo();
  assert.equal(runCli(root, ['init']).status, 0);
  const file = join(root, 'sloop.config.yaml');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, `${before}\n# user change\n`);
  const result = runCli(root, ['init']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(file, 'utf8'), `${before}\n# user change\n`);
  assert.match(result.stdout, /already exists; leaving it unchanged/);
});

test('wizard accepts defaults and writes a valid canonical config', async () => {
  const root = createRepo();
  const io = scriptedIO(['', 'y', 'n']);
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
  const root = createRepo();
  const modeIO = scriptedIO(['pijs', 'worktree', 'y', 'n']);
  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.mode'], undefined, modeIO),
    0,
    modeIO.text(),
  );
  const rootIO = scriptedIO(['.tmp/worktrees', 'y']);
  assert.equal(
    await runConfigCommand(root, ['workspace.worktreeRoot'], undefined, rootIO),
    0,
    rootIO.text(),
  );
  const baseIO = scriptedIO(['develop', 'y']);
  assert.equal(
    await runConfigCommand(root, ['repository.baseBranch'], undefined, baseIO),
    0,
    baseIO.text(),
  );
  const checksIO = scriptedIO(['ci,qa', 'y']);
  assert.equal(
    await runConfigCommand(root, ['workflow.requiredChecks'], undefined, checksIO),
    0,
    checksIO.text(),
  );
  const text = readFileSync(join(root, 'sloop.config.yaml'), 'utf8');
  const config = loadConfigText(text);
  assert.equal(config.repository.baseBranch, 'develop');
  assert.equal(config.workspace.mode, 'worktree');
  assert.equal(config.workspace.worktreeRoot, '.tmp/worktrees');
  assert.deepEqual(config.workflow.requiredChecks, ['ci', 'qa']);
  assert.equal((modeIO.text().match(/workspace\.mode\n/g) ?? []).length, 2);
});

test('wizard cancellation does not create a config', async () => {
  const root = createRepo();
  const io = scriptedIO(['', 'n']);
  assert.equal(
    await runConfigCommand(root, ['--init', '--wizard', 'workspace.path'], undefined, io),
    0,
    io.text(),
  );
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

test('invalid init usage fails without creating a config', () => {
  const root = createRepo();
  const result = runCli(root, ['init', '--unknown']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: sloop init \[--wizard\]/);
  assert.equal(existsSync(join(root, 'sloop.config.yaml')), false);
});

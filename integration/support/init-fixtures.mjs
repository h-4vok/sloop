import { createIsolatedTemporaryDirectory } from '../../test/support/temporary-directory.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

export const repoRoot = join(import.meta.dirname, '../..');
export const cli = join(repoRoot, 'dist', 'cli.js');
const temporaryRepos = new Set();

export function cleanupTemporaryRepos() {
  for (const root of temporaryRepos) rmSync(root, { recursive: true, force: true });
  temporaryRepos.clear();
}

export function trackTemporaryRepo(root) {
  temporaryRepos.add(root);
  return root;
}

export function createRepository() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-init-integration-'));
  temporaryRepos.add(root);
  writeFileSync(join(root, 'readme.md'), '# integration\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Sloop Integration Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'sloop-integration@example.test'], { cwd: root });
  execFileSync('git', ['add', 'readme.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: seed integration repo'], {
    cwd: root,
    stdio: 'ignore',
  });
  return root;
}

export function runSloopCli(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
}

export function createMockScriptedIo(answers) {
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

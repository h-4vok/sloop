import { createIsolatedTemporaryDirectory } from '../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { productionDependencies } from '../../src/adapters.js';
import { loadConfigText, canonicalConfigYaml } from '../../src/config.js';
import { CliFailure } from '../../src/dispatcher.js';
import { runManifestMarker } from '../../src/remote-state.js';

function decodeForwardedArguments(stdin, args) {
  if (stdin === undefined) return args;
  const lines = stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

function createMockFollowUpIssueHarness(hasFollowUpIssue) {
  const calls = [];
  const key = 'sloop/arbiter/follow-up/41/Q1';
  const execute = (_file, args) => {
    calls.push([...args]);
    if (args[0] === 'issue' && args[1] === 'list')
      return hasFollowUpIssue
        ? JSON.stringify([{ number: 88, body: `Idempotency key: ${key}` }])
        : '[]';
    return 'https://github.com/h-4vok/sloop/issues/99';
  };
  const dependencies = productionDependencies(
    createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-arbiter-issue-')),
    loadConfigText(canonicalConfigYaml()),
    'h-4vok/sloop',
    { execFileSync: execute },
  );

  return { calls, dependencies, key };
}

test('production adapter passes explicit full access to the Codex harness', async () => {
  const config = loadConfigText(
    canonicalConfigYaml().replaceAll('workspace-write', 'danger-full-access'),
  );
  const calls = [];
  const dependencies = productionDependencies(process.cwd(), config, 'h-4vok/sloop', {
    codexSpawn(file, args, options) {
      const child = new EventEmitter();
      child.stdin = { end: (chunk) => (child.input = chunk) };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      calls.push({ file, args, options, child });
      queueMicrotask(() => {
        child.stdout.emit('data', '{"type":"thread.started","thread_id":"full-access-session"}\n');
        child.emit('close', 0);
      });
      return child;
    },
  });
  const harness = dependencies.harness('worker', { timeoutMs: 1_000 }, {}, { write: () => {} });

  const result = await harness.start(
    { issue: 1, role: 'worker', run: 'run-a', repository: 'owner/repo', issueContext: 'test' },
    { prompt: 'continue' },
  );

  assert.deepEqual(result, { accepted: true, session: 'full-access-session' });
  assert.equal(calls[0].file, process.platform === 'win32' ? 'powershell.exe' : 'codex');
  assert.equal(calls[0].options.shell, false);
  const codexArgs = decodeForwardedArguments(calls[0].child.input, calls[0].args);
  assert.equal(codexArgs[codexArgs.indexOf('--sandbox') + 1], 'danger-full-access');
});

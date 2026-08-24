import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { HELP, requireSupportedNode } from '../dist/cli.js';

const cli = resolve('dist/cli.js');

test('help documents the linked CLI contract', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Sloop 0\.1\.0/m);
  assert.match(result.stdout, /Usage: sloop <command> \[option\]/);
  assert.equal(result.stdout.trim(), HELP);
});

test('version reports the package version', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('help and version work outside the Sloop checkout', () => {
  const outside = mkdtempSync(join(tmpdir(), 'sloop-cli-outside-'));
  try {
    for (const flag of ['--help', '--version']) {
      const result = spawnSync(process.execPath, [cli, flag], { cwd: outside, encoding: 'utf8' });
      assert.equal(result.status, 0, `${flag}: ${result.stderr}`);
      assert.notEqual(result.stdout.trim(), '');
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('unsupported Node stops before dispatcher loading', () => {
  assert.throws(() => requireSupportedNode('v21.9.0'), /requires Node\.js 22 or newer.*v21\.9\.0/);
  const result = spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires Node\.js 22 or newer/);
  assert.equal(result.stdout, '');
});

test('unsupported Node emits the global envelope when JSON was requested', () => {
  const result = spawnSync(process.execPath, [cli, 'status', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', SLOOP_TEST_NODE_VERSION: 'v20.0.0' },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.command, 'status');
  assert.equal(envelope.status, 'failed');
  assert.equal(envelope.phase, 'preflight');
  assert.equal(envelope.diagnostics[0].check, 'node');
});

import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { test } from 'vitest';
import {
  discoverRepository as discoverRepositoryResult,
  EXIT,
  parseCliCommand as parseCliCommandResult,
  parseReadOnlyCommand as parseReadOnlyCommandResult,
  parseDispatcherCommand as parseDispatcherCommandResult,
  emitNodeVersionFailure,
  emitUsageFailure,
  resultOutput,
  runDispatcherPreflight,
  runReadOnlyCommand,
} from '../../../src/runtime.js';
import { canonicalConfigYaml } from '../../../src/config.js';

const config = canonicalConfigYaml();

const unwrap = (parsed) => {
  if (parsed.ok) return parsed.value;
  throw new Error(parsed.error);
};

const parseCliCommand = (args) => unwrap(parseCliCommandResult(args));
const parseReadOnlyCommand = (args) => unwrap(parseReadOnlyCommandResult(args));
const parseDispatcherCommand = (args) => unwrap(parseDispatcherCommandResult(args));
const discoverRepository = (io) => unwrap(discoverRepositoryResult(io));

function createMockRuntimeHarness(overrides = {}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  const readableFiles = new Set(overrides.readableFiles ?? []);
  const responses = createRuntimeResponses(overrides);
  const io = createRuntimeIo({ calls, stdout, stderr, readableFiles, overrides, responses });
  return { io, calls, stdout, stderr };
}

function createRuntimeResponses(overrides) {
  const labelNames = [
    'Automation Ready',
    'Automation Claimed',
    'Automation Blocked',
    'Priority: P0',
    'Priority: P1',
    'Priority: P2',
  ];
  return {
    'git rev-parse --show-toplevel': { stdout: '/repo\n', stderr: '', status: 0 },
    'git --version': { stdout: 'git version 2.50', stderr: '', status: 0 },
    'git remote get-url origin': { stdout: 'https://github.com/o/r.git', stderr: '', status: 0 },
    'git rev-parse --verify origin/main^{commit}': { stdout: 'abc', stderr: '', status: 0 },
    'git status --porcelain': { stdout: '', stderr: '', status: 0 },
    'git symbolic-ref --short HEAD': { stdout: 'codex/issue-31', stderr: '', status: 0 },
    'gh --version': { stdout: 'gh version 2', stderr: '', status: 0 },
    'gh auth status': { stdout: '', stderr: '', status: 0 },
    'gh repo view https://github.com/o/r.git --json nameWithOwner,viewerPermission': {
      stdout: '{"nameWithOwner":"o/r","viewerPermission":"WRITE"}',
      stderr: '',
      status: 0,
    },
    'gh label list --repo o/r --limit 1000 --json name': {
      stdout: JSON.stringify(labelNames.map((name) => ({ name }))),
      stderr: '',
      status: 0,
    },
    'gh issue list --state open --label Automation Ready --repo o/r --json number,title,url,labels':
      {
        stdout: '[{"number":31,"title":"Discovery"}]',
        stderr: '',
        status: 0,
      },
    'codex --version': { stdout: 'codex 1', stderr: '', status: 0 },
    ...overrides,
  };
}

function createRuntimeIo({ calls, stdout, stderr, readableFiles, overrides, responses }) {
  return {
    cwd: '/repo/nested',
    platform: 'linux',
    nodeVersion: 'v22.1.0',
    homeDirectory: homedir(),
    run(file, args, cwd) {
      calls.push({ file, args: [...args], cwd });
      return (
        responses[`${file} ${args.join(' ')}`] ?? { stdout: '', stderr: 'unexpected', status: 1 }
      );
    },
    readFile: (file) => overrides.localConfig ?? config,
    canRead: (file) => readableFiles.has(file),
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  };
}

export {
  config,
  unwrap,
  parseCliCommand,
  parseReadOnlyCommand,
  parseDispatcherCommand,
  discoverRepository,
  createMockRuntimeHarness,
};

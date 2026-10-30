import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexHarness } from '../../src/harness.js';

export const context = {
  issue: 114,
  role: 'worker',
  run: 'run-a',
  repository: 'repo context',
  issueContext: 'issue context',
  progress: 'progress',
  qaUpdates: 'qa updates',
};

export function createMockCodexProcess({ stdout = [], stderr = [], code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = { end: (chunk) => (child.input = chunk) };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    for (const chunk of stdout) child.stdout.emit('data', chunk);
    for (const chunk of stderr) child.stderr.emit('data', chunk);
    child.emit('close', code);
  });
  return child;
}

export function createMockCodexHarness(response, calls, logs = []) {
  return new CodexHarness({
    cwd: 'fixture-repository',
    model: 'gpt-5-codex',
    sandbox: 'workspace-write',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    log: (source, chunk) => logs.push([source, chunk]),
    spawn: (file, args, options) => {
      const child = createMockCodexProcess(response);
      calls.push({ file, args, options, child });
      return child;
    },
  });
}

export function getLaunchedCodexArgs(call) {
  if (call.child.input === undefined) return call.args;
  const lines = call.child.input.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), encodedArgs.length);
  return encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

export function createMemorySessionIO(initialContent) {
  let content = initialContent;
  return {
    get content() {
      return content;
    },
    async read() {
      if (content !== undefined) return content;
      const missingFileError = new Error('file not found');
      missingFileError.code = 'ENOENT';
      throw missingFileError;
    },
    async write(_file, value) {
      content = value;
    },
  };
}

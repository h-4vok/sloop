import { spawn } from 'node:child_process';
import type { ProcessExecutor } from './AgentEnvelope.js';
import { terminateProcessTree } from './terminateProcessTree.js';

/** Spawns an agent process without a shell and captures streams until completion. */
export const executeAgentProcess: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,

      env: options.env,

      shell: false,

      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr || (options.stdin !== undefined && !child.stdin)) {
      terminateProcessTree(child);
      return reject(new Error('Codex process streams were not created'));
    }
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    let stdout = '',
      stderr = '';
    let hasTimedOut = false;
    const timer = setTimeout(() => {
      hasTimedOut = true;
      terminateProcessTree(child);
    }, options.timeoutMs);
    child.stdout.on('data', (b) => {
      const s = String(b);
      stdout += s;
      options.onStdout(s);
    });
    child.stderr.on('data', (b) => {
      const s = String(b);
      stderr += s;
      options.onStderr(s);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (hasTimedOut) {
        reject(new Error('runner timed out'));
        return;
      }
      resolve({ stdout, stderr, code, signal });
    });
  });

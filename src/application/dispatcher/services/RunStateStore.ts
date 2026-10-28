/** Coordinates run state store operations for dispatcher workflows. */
import type { State } from '../../../application/dispatcher/types/index.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { RunStatePolicy } from './RunStatePolicy.js';
const { status, defaultProcessAlive, isActiveStatus } = RunStatePolicy;
import { DispatcherRuntime } from './DispatcherRuntime.js';
const { defaultRoot } = DispatcherRuntime;

const stateDir = join(defaultRoot, '.sloop');

const stateFile = join(stateDir, 'state.json');

function readState(file = stateFile): State {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      status: 'blocked',

      lastError: `state corruption: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function writeState(s: State, file = stateFile): void {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function resetRunState(state: State, processAlive = defaultProcessAlive): State {
  if (isActiveStatus(state.status) && state.workerPid && processAlive(state.workerPid))
    throw new Error(`cannot reset while Worker process ${state.workerPid} is still running`);
  return {
    completedIssues: state.completedIssues ?? [],

    mainGreen: state.mainGreen,

    drainStatus: 'running',

    updatedAt: Date.now(),
  };
}

export const RunStateStore = {
  readState,

  writeState,

  resetRunState,

  stateDir,

  stateFile,
};

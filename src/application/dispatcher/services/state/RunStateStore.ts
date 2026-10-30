import type { State } from '../../../../application/dispatcher/types/index.js';
import { result, type Result } from '../../../../core/Result.js';
import { join } from 'node:path';
import { RunStatePolicy } from './RunStatePolicy.js';
const { isActiveStatus } = RunStatePolicy;

/** Injected file operations keep persisted-state policy independent from Node I/O. */
export type RunStateFileIO = Readonly<{
  exists(file: string): boolean;

  read(file: string): string;

  makeDirectory(directory: string): void;

  write(file: string, contents: string): void;

  rename(source: string, destination: string): void;
}>;

/** Builds the local run-state store from injected filesystem and process ports. */
function createRunStateStore(
  io: RunStateFileIO,
  root: string,
  pid: () => number,
  now: () => number,
  processAlive: (processId: number) => boolean,
) {
  const stateDir = join(root, '.sloop');
  const stateFile = join(stateDir, 'state.json');

  return Object.freeze({
    readState: (file = stateFile) => readState(io, file),

    writeState: (state: State, file = stateFile) => writeState(io, pid, state, file),

    resetRunState: (state: State, isProcessAlive = processAlive) =>
      resetRunState(state, isProcessAlive, now),

    stateDir,

    stateFile,
  });
}

function readState(io: RunStateFileIO, file: string): State {
  try {
    if (!io.exists(file)) return {};
    return JSON.parse(io.read(file));
  } catch (error) {
    return {
      status: 'blocked',

      lastError: `state corruption: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function writeState(
  io: RunStateFileIO,
  pid: () => number,
  state: State,
  file: string,
): Result<void, Error> {
  try {
    io.makeDirectory(join(file, '..'));
    const temporaryFile = `${file}.${pid()}.tmp`;
    io.write(temporaryFile, `${JSON.stringify(state, null, 2)}\n`);

    return renameStateFile(io, temporaryFile, file);
  } catch (error) {
    return result.failure(toError(error));
  }
}

function renameStateFile(
  io: RunStateFileIO,
  temporaryFile: string,
  file: string,
): Result<void, Error> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      io.rename(temporaryFile, file);
      return result.success(undefined);
    } catch (error) {
      lastError = error;
    }
  }

  return result.failure(toError(lastError));
}

function resetRunState(
  state: State,
  processAlive: (pid: number) => boolean,
  now: () => number,
): Result<State, Error> {
  if (isActiveStatus(state.status) && state.workerPid && processAlive(state.workerPid))
    return result.failure(
      new Error(`cannot reset while Worker process ${state.workerPid} is still running`),
    );
  return result.success({
    completedIssues: state.completedIssues ?? [],

    mainGreen: state.mainGreen,

    drainStatus: 'running',

    updatedAt: now(),
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const RunStateStore = { createRunStateStore };

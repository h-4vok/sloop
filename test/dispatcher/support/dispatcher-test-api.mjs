import { createIsolatedTemporaryDirectory } from '../../support/temporary-directory.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, vi } from 'vitest';
import * as dispatcher from '../../../src/dispatcher.js';
import { parseDispatcherCommand as parseDispatcherCommandResult } from '../../../src/runtime.js';
import { issueLabelNames } from '../../../src/issue-selection.js';
import { artifactKey, runManifestMarker } from '../../../src/remote-state.js';

const parseDispatcherCommand = (args) => {
  const parseResult = parseDispatcherCommandResult(args);
  if (parseResult.ok) return parseResult.value;
  throw new Error(parseResult.error);
};

export {
  createIsolatedTemporaryDirectory,
  assert,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  vi,
  issueLabelNames,
  artifactKey,
  runManifestMarker,
  parseDispatcherCommandResult,
  parseDispatcherCommand,
};
export const {
  acquire,
  childProcessInvocation,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatcherLockPath,
  defaultProcessAlive,
  dispatch,
  eligible,
  linkIssueToActiveRun,
  pullRequest,
  pullRequestBody,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  resolveReviewCap,
  resolveExecutable,
  runSyncCommand,
  redactDiagnostic,
  readState,
  reviewFeedback,
  workerBranchName,
  withIssueClosingReference,
  resetRunState,
  runCommand,
  hasCommit,
  runDispatcherCli,
  updatePullRequestBody,
  commentPullRequest,
  writeState,
  maxRoundsForUserBudget,
  selectIssues,
} = dispatcher;

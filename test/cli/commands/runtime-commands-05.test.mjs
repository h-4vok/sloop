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

import {
  config,
  unwrap,
  parseCliCommand,
  parseReadOnlyCommand,
  parseDispatcherCommand,
  discoverRepository,
  createMockRuntimeHarness,
} from '../support/runtime-support.mjs';

test('status recovery guidance remains safe and contextual when issue or PR data is absent', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-recovery-guidance-'));

  try {
    mkdirSync(join(root, '.sloop'));
    writeFileSync(join(root, '.sloop', 'state.json'), JSON.stringify({ status: 'ci_failed' }));
    const runtimeHarness = createMockRuntimeHarness({
      'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },

      readableFiles: [join(root, '.sloop', 'state.json')],
    });
    runtimeHarness.io.cwd = root;
    runtimeHarness.io.readFile = (file) =>
      file.endsWith(join('.sloop', 'state.json')) ? readFileSync(file, 'utf8') : config;
    const readOnlyArgs = ['status', '--json'];
    const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
    assert.equal(runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io), EXIT.ok);
    const result = JSON.parse(runtimeHarness.stdout[0]);
    assert.deepEqual(result.result.nextAction, {
      command: 'sloop status --verbose',

      description: 'Inspect the recovery state; issue or PR context is unavailable.',

      mutates: false,
    });
    assert.ok(!runtimeHarness.calls.some(({ file }) => file === 'gh'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status diagnoses every recovery observation with contextual safe guidance', () => {
  const observations = [
    ['leaseActive', 'lease', 'Another dispatcher owns an active run lease.'],
    ['blockedPhase', 'blocked', 'The remote workflow phase is blocked.'],
    ['artifactMissing', 'artifact', 'The expected run artifact is absent.'],
    ['configStale', 'configuration', 'The recorded configuration fingerprint is stale.'],
    ['checkoutDirty', 'checkout', 'The checkout has uncommitted changes.'],
    ['checksFailed', 'checks', 'One or more required PR checks failed.'],
    ['prClosedUnmerged', 'pull request', 'The pull request is closed but not merged.'],
    ['schedulerDrift', 'scheduler', 'The scheduler configuration or heartbeat has drifted.'],
  ];
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-recovery-matrix-'));

  try {
    mkdirSync(join(root, '.sloop'));
    for (const [flag, phase, blocker] of observations) {
      assertRecoveryObservation(root, flag, phase, blocker);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function assertRecoveryObservation(root, flag, phase, blocker) {
  const statePath = join(root, '.sloop', 'state.json');
  writeFileSync(
    statePath,
    JSON.stringify({ status: 'ci_failed', issue: 45, pr: 107, [flag]: true }),
  );
  const runtimeHarness = createMockRuntimeHarness({
    'git rev-parse --show-toplevel': { stdout: `${root}\n`, stderr: '', status: 0 },
    readableFiles: [statePath],
  });
  runtimeHarness.io.cwd = root;
  runtimeHarness.io.readFile = (file) =>
    file.endsWith(join('.sloop', 'state.json')) ? readFileSync(file, 'utf8') : config;

  const readOnlyArgs = ['status', '--json'];
  const parsedReadOnlyCommand = parseReadOnlyCommand(readOnlyArgs);
  assert.equal(
    runReadOnlyCommand(parsedReadOnlyCommand, runtimeHarness.io),
    EXIT.ok,
    `status should inspect ${flag}`,
  );
  const diagnostic = JSON.parse(runtimeHarness.stdout[0]).diagnostics.find(
    (item) => item.check === `recovery-${phase}`,
  );
  assert.deepEqual(diagnostic, {
    check: `recovery-${phase}`,
    message: `${blocker} (issue #45, PR #107)`,
    remediation: 'Next: sloop --prepare-recovery 45 --pr 107; this mutates local recovery state.',
    phase,
    context: { issue: 45, pullRequest: 107 },
    nextAction: {
      command: 'sloop --prepare-recovery 45 --pr 107',
      description: 'Prepare the recorded recovery for the issue and pull request.',
      mutates: true,
    },
    mutates: false,
  });
  assert.equal(
    runtimeHarness.calls.some(
      ({ file, args }) => file === 'gh' || ['checkout', 'reset', 'clean', 'push'].includes(args[0]),
    ),
    false,
    `${flag} diagnosis must not mutate local or remote state`,
  );
}

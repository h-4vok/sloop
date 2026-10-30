import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dispatch, CliFailure } from '../src/dispatcher.js';
import { createFaultRunManifest, faultConfig } from '../test/support/issue33FaultFixtures.mjs';
import { createMockFaultHarness } from '../test/support/issue33FaultHarness.mjs';

test('dispatcher fails closed on GitHub outage before any remote write or workspace work', async () => {
  const faultHarness = createMockFaultHarness({ outage: true });

  assert.equal(await dispatch(faultConfig, faultHarness.dependencies), 4);
  assert.deepEqual(faultHarness.counts(), { claimCount: 0, publishCount: 0, prepareCount: 0 });
});

test('dispatcher reconciles an ambiguous claim instead of publishing a duplicate', async () => {
  const faultHarness = createMockFaultHarness({ ambiguous: true });

  assert.equal(await dispatch(faultConfig, faultHarness.dependencies), 0);
  assert.equal(faultHarness.counts().claimCount, 1);
  assert.equal(faultHarness.counts().prepareCount, 1);
  assert.ok(faultHarness.counts().publishCount >= 1);
});

test('dispatcher recovers a remote marker after crash before local acknowledgement', async () => {
  const first = createMockFaultHarness({ crashAfterClaim: true });

  assert.equal(await dispatch(faultConfig, first.dependencies), 4);
  const second = createMockFaultHarness({ remoteManifest: first.remote() });
  assert.equal(await dispatch(faultConfig, second.dependencies), 0);
  assert.equal(second.counts().claimCount, 0);
  assert.equal(second.counts().prepareCount, 1);
});

test('dispatcher preserves a verified explicitly prepared PR when the remote manifest has none', async () => {
  const faultHarness = createMockFaultHarness({
    remoteManifest: createFaultRunManifest({ omitPr: true }),

    initialState: {
      issue: 33,

      pr: 14,

      branch: 'codex/issue-33-fault',

      headSha: 'abcdef1',

      status: 'worker_recovery_pending',

      preparedRecovery: true,

      workerRunId: 'prepared-recovery-run',
    },
  });

  assert.equal(await dispatch(faultConfig, faultHarness.dependencies), 0);
  assert.equal(faultHarness.dependencies.load().pr, 14);
  assert.equal(faultHarness.dependencies.load().branch, 'codex/issue-33-fault');
  assert.equal(faultHarness.dependencies.load().preparedRecovery, undefined);
  assert.ok(
    faultHarness.events().findIndex((event) => event.type === 'pullRequest') <
      faultHarness.events().findIndex((event) => event.type === 'worker'),
  );
});

test('dispatcher rejects an unverified prepared PR before hydration or Worker execution', async () => {
  const invalidEvidence = [
    { state: 'CLOSED' },
    { baseRefName: 'release' },
    { headRefName: 'codex/other-branch' },
    { body: 'Summary\n\nCloses #99' },
    { number: 15 },
  ];

  for (const evidence of invalidEvidence) {
    const faultHarness = createMockFaultHarness({
      remoteManifest: createFaultRunManifest({ omitPr: true }),

      initialState: {
        issue: 33,

        pr: 14,

        branch: 'codex/issue-33-fault',

        status: 'worker_recovery_pending',

        preparedRecovery: true,
      },

      pullRequestEvidence: evidence,
    });

    assert.equal(await dispatch(faultConfig, faultHarness.dependencies), 4);
    assert.equal(faultHarness.dependencies.load().pr, 14);
    assert.equal(faultHarness.dependencies.load().preparedRecovery, true);
    assert.equal(
      faultHarness.events().some((event) => event.type === 'worker'),
      false,
    );
  }
});

test('dispatcher reclaims an expired remote lease and preserves the artifact identity', async () => {
  const manifest = createFaultRunManifest({
    lease: { owner: 'old-owner', expiresAt: new Date(Date.now() - 1).toISOString() },
  });
  const faultHarness = createMockFaultHarness({ remoteManifest: manifest });

  assert.equal(await dispatch(faultConfig, faultHarness.dependencies), 0);
  assert.equal(faultHarness.counts().claimCount, 0);
  assert.ok(faultHarness.counts().publishCount >= 1);
  assert.equal(faultHarness.remote().artifacts[0], manifest.artifacts[0]);
  assert.equal(
    faultHarness.published().find((candidate) => candidate.phase === 'working').lease.owner,
    '7001:33',
  );
});

test('dispatcher refuses a competing live remote lease', async () => {
  const manifest = createFaultRunManifest({
    lease: { owner: 'other-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  const faultHarness = createMockFaultHarness({ remoteManifest: manifest });
  await assert.rejects(
    () => dispatch(faultConfig, faultHarness.dependencies),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );

  assert.equal(faultHarness.counts().prepareCount, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactKey, projectRemoteState } from '../dist/remote-state.js';
import { dispatch, CliFailure } from '../dist/dispatcher.js';
import { RunLogger, runDirectory, applyRunRetention } from '../dist/run-log.js';
import { allowlistedPublication } from '../dist/publication.js';
import { withEphemeralMutex } from '../dist/mutex.js';
import { command, runCommand } from '../dist/dispatcher.js';

test('remote projection is deterministic and ignores unrelated markers', () => {
  const s = { issue: 33, markers: ['other/In Progress'], labels: ['In Progress'] };
  assert.deepEqual(
    projectRemoteState(s),
    projectRemoteState({ ...s, labels: [...s.labels].reverse() }),
  );
  assert.equal(projectRemoteState(s).phase, 'idle');
  assert.equal(artifactKey('run', { b: 2, a: 1 }), artifactKey('run', { a: 1, b: 2 }));
});

test('run logger writes ordered sensitive local JSONL with restrictive permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'run/one'));
  logger.write('stdout', 'line 1\nline 2');
  logger.write('transition', { phase: 'review' });
  const events = readFileSync(logger.file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map(({ seq, type }) => [seq, type]),
    [
      [1, 'stdout'],
      [2, 'transition'],
    ],
  );
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(logger.file, '..')).mode & 0o777, 0o700);
    assert.equal(statSync(logger.file).mode & 0o777, 0o600);
  }
  const reopened = new RunLogger(join(logger.file, '..'));
  reopened.write('result', 'continues sequence');
  assert.equal(JSON.parse(readFileSync(reopened.file, 'utf8').trim().split('\n').at(-1)).seq, 3);
});

test('real command execution captures Unicode and multiline stdout/stderr in arrival order', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'streams/✓'));
  const seen = [];
  const output = await runCommand(
    {
      ...command(
        {
          command: process.execPath,
          args: [
            '-e',
            "process.stdout.write('salut ✓\\nline two\\n'); process.stderr.write('ошибка\\nline err\\n')",
          ],
        },
        33,
      ),
      onStdout: (chunk) => {
        seen.push('stdout');
        logger.stream('stdout', chunk);
      },
      onStderr: (chunk) => {
        seen.push('stderr');
        logger.stream('stderr', chunk);
      },
    },
    root,
  );
  assert.match(output, /salut ✓/);
  const text = readFileSync(logger.file, 'utf8');
  assert.match(text, /ошибка/);
  assert.match(text, /line two/);
  assert.deepEqual(new Set(seen), new Set(['stdout', 'stderr']));
  const events = text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_, index) => index + 1),
  );
});

test('publication allowlist excludes raw channels and redacts credentials', () => {
  assert.deepEqual(allowlistedPublication({ raw: 'secret', token: 'abc', summary: 'ok' }), {
    token: '<redacted>',
    summary: 'ok',
  });
});

test('ephemeral mutex releases after the run', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  assert.equal(
    withEphemeralMutex(root, 'a', () => 3),
    3,
  );
  assert.equal(
    withEphemeralMutex(root, 'b', () => 4),
    4,
  );
});

test('projection handles leases, gates, unsupported protocols, and marker reconciliation', () => {
  const manifest = {
    protocol: 1,
    runId: 'r',
    issue: 33,
    branch: 'b',
    baseSha: 'abcdef1',
    configFingerprint: 'f',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: [],
    lease: { owner: 'a', expiresAt: new Date(Date.now() + 60000).toISOString() },
  };
  const projected = projectRemoteState({
    issue: 33,
    markers: ['sloop/v1/run/r'],
    manifest,
    labels: ['Automation Blocked'],
    branch: 'wrong',
    sha: 'bad',
    leaseOwner: 'b',
  });
  assert.equal(projected.phase, 'review');
  assert.ok(projected.openGates.includes('lease:owned'));
  assert.throws(() => projectRemoteState({ issue: 33, protocol: 99 }), /unsupported/);
});

test('logging retains runs by default and supports explicit retention', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const logger = new RunLogger(runDirectory(root, 33, 'unicode/✓'));
  logger.command('node', 'ü\nstdout', 'err\n', root);
  logger.stream('codex', 'multi\nline');
  assert.ok(statSync(logger.file).mode & 0o200);
  applyRunRetention(root);
  assert.ok(readFileSync(logger.file, 'utf8').includes('multi'));
});

test('explicit retention removes only expired run directories and never unsafe siblings', () => {
  const root = mkdtempSync(join(tmpdir(), 'sloop-'));
  const old = runDirectory(root, 33, 'old', new Date('2020-01-01T00:00:00Z'));
  const fresh = runDirectory(root, 33, 'fresh', new Date('2026-09-09T00:00:00Z'));
  new RunLogger(old);
  new RunLogger(fresh);
  applyRunRetention(root, 24 * 60 * 60 * 1000, Date.parse('2026-09-10T00:00:00Z'));
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
});

test('publication boundary removes bearer, cookie, and URL credentials', () => {
  const value = allowlistedPublication(
    'Authorization: Bearer abc\nCookie: sid=xyz https://u:p@example.test/x',
  );
  assert.equal(String(value).includes('abc'), false);
  assert.equal(String(value).includes('xyz'), false);
  assert.equal(String(value).includes('u:p@'), false);
});

const faultConfig = {
  baseBranch: 'main',
  workerCommand: {
    command: 'codex',
    args: ['exec', '--sandbox', 'read-only'],
    timeoutMs: 1000,
    retries: 0,
  },
  qaCommand: {
    command: 'codex',
    args: ['exec', '--sandbox', 'read-only'],
    timeoutMs: 1000,
    retries: 0,
  },
  requiredPrChecks: ['pr-checks'],
  checkPollIntervalMs: 0,
  checkTimeoutMs: 1000,
  evidencePollIntervalMs: 0,
  evidenceTimeoutMs: 1000,
  workerLeaseMs: 60_000,
  maxReviewRounds: 3,
};

function faultManifest(overrides = {}) {
  const runId = overrides.runId ?? 'fault-run';
  const key = artifactKey('run', { issue: 33, runId });
  return {
    protocol: 1,
    runId,
    issue: 33,
    pr: 14,
    branch: 'codex/issue-33-fault',
    baseSha: 'abcdef1',
    configFingerprint: 'config-fingerprint',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'cursor',
    artifacts: [key],
    ...(overrides.lease ? { lease: overrides.lease } : {}),
  };
}

function faultHarness({
  remoteManifest,
  outage = false,
  ambiguous = false,
  crashAfterClaim = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sloop-fault-'));
  let state = {};
  let remote = remoteManifest;
  let claimCount = 0;
  let publishCount = 0;
  const publishedManifests = [];
  let prepareCount = 0;
  let crashTriggered = false;
  const comments = [];
  const reviews = [];
  const pr = {
    number: 14,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'codex/issue-33-fault',
    headRefOid: 'abcdef1',
    body: 'Summary',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    comments,
    reviews,
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  const snapshot = () => {
    if (outage) throw new Error('GitHub outage');
    return {
      issue: 33,
      markers: remote ? [`sloop/v1/run/${remote.runId}`, ...remote.artifacts] : [],
      manifest: remote,
      branch: remote?.branch,
      sha: remote?.baseSha,
      now: Date.now(),
      leaseOwner: '7001:33',
    };
  };
  const deps = {
    root,
    load: () => state,
    save: (next) => {
      if (crashAfterClaim && claimCount > 0 && next.workerRunId && !crashTriggered) {
        crashTriggered = true;
        throw new Error('crash before local acknowledgement');
      }
      state = structuredClone(next);
    },
    loadConfig: () => faultConfig,
    status: (verbose) => (verbose ? state : { issue: state.issue, status: state.status }),
    list: () => [],
    recoverLock: () => 'none',
    reset: () => {},
    resolveReviewCap: () => {},
    linkIssue: () => {},
    prepareRecovery: () => 14,
    eligible: () => [{ number: 33, title: 'fault injection' }],
    comment: (issue, body) => comments.push({ issue, body }),
    run: async (spec) => {
      if (spec.input?.includes('Use the worker skill')) {
        spec.onStart?.(7002);
        comments.push({
          body: `[Worker] round=1 status=ready_for_review pr=14 base=main commit=abcdef2\n\n[Human Verification]\n\`\`\`json\n{"summary":"fault","steps":["run"],"expected":["pass"],"isolation":"temp","limitations":["none"],"checklist":["pass"]}\n\`\`\``,
        });
        pr.headRefOid = 'abcdef2';
        return 'WORKER_RESULT pr=14 base=main';
      }
      if (spec.input?.includes('Use the qa-sdet skill')) {
        reviews.push({
          body: '[QA/SDET Review] round=1 verdict=passed commit=abcdef2',
          commitId: 'abcdef2',
          submittedAt: '1',
        });
        return 'QA_RESULT';
      }
      return 'ok';
    },
    pullRequest: () => structuredClone(pr),
    updatePullRequestBody: (_number, body) => {
      pr.body = body;
    },
    pullRequestBody: () => pr.body,
    prComment: (_number, body) => comments.push({ body }),
    now: () => Date.now(),
    pid: () => 7001,
    processAlive: () => true,
    sleep: async () => {},
    onReclaim: () => {},
    tryAcquire: () => true,
    readOwner: () => {
      throw new Error('unused');
    },
    tryBeginReclaim: () => true,
    readReclaimOwner: () => {
      throw new Error('unused');
    },
    reclaimAgeMs: () => 0,
    finishReclaim: () => {},
    abandonReclaim: () => {},
    release: () => {},
    prepareWorkerBranch: () => ({ branch: 'codex/issue-33-fault', mainBaseSha: 'abcdef1' }),
    checkoutWorkerBranch: () => {},
    workspaceAdapter: {
      prepare: () => {
        prepareCount += 1;
        return {
          workspaceRoot: root,
          executionRoot: root,
          branch: 'codex/issue-33-fault',
          baseSha: 'abcdef1',
          headSha: 'abcdef1',
          ownership: {
            runId: state.workerRunId ?? 'fault-run',
            issue: 33,
            protocol: 'sloop-workspace-v1',
          },
        };
      },
      recover: (_issue, runId, branch) =>
        remote && branch && branch !== 'pending'
          ? {
              workspaceRoot: root,
              executionRoot: root,
              branch,
              baseSha: 'abcdef1',
              headSha: 'abcdef1',
              ownership: { runId, issue: 33, protocol: 'sloop-workspace-v1' },
            }
          : undefined,
      cleanup: () => {},
    },
    remote: {
      snapshot,
      reconcile: (_issue, key) => Boolean(remote?.artifacts.includes(key)),
      claim: (_issue, key, manifest) => {
        claimCount += 1;
        remote = { ...manifest, artifacts: [key] };
        if (ambiguous) throw new Error('ambiguous remote response');
      },
      publish: (_issue, manifest) => {
        publishCount += 1;
        publishedManifests.push(manifest);
        remote = manifest;
      },
    },
  };
  return {
    deps,
    counts: () => ({ claimCount, publishCount, prepareCount }),
    remote: () => remote,
    published: () => publishedManifests,
  };
}

test('dispatcher fails closed on GitHub outage before any remote write or workspace work', async () => {
  const h = faultHarness({ outage: true });
  assert.equal(await dispatch(faultConfig, h.deps), 4);
  assert.deepEqual(h.counts(), { claimCount: 0, publishCount: 0, prepareCount: 0 });
});

test('dispatcher reconciles an ambiguous claim instead of publishing a duplicate', async () => {
  const h = faultHarness({ ambiguous: true });
  assert.equal(await dispatch(faultConfig, h.deps), 0);
  assert.equal(h.counts().claimCount, 1);
  assert.equal(h.counts().prepareCount, 1);
  assert.ok(h.counts().publishCount >= 1);
});

test('dispatcher recovers a remote marker after crash before local acknowledgement', async () => {
  const first = faultHarness({ crashAfterClaim: true });
  assert.equal(await dispatch(faultConfig, first.deps), 4);
  const second = faultHarness({ remoteManifest: first.remote() });
  assert.equal(await dispatch(faultConfig, second.deps), 0);
  assert.equal(second.counts().claimCount, 0);
  assert.equal(second.counts().prepareCount, 1);
});

test('dispatcher reclaims an expired remote lease and preserves the artifact identity', async () => {
  const manifest = faultManifest({
    lease: { owner: 'old-owner', expiresAt: new Date(Date.now() - 1).toISOString() },
  });
  const h = faultHarness({ remoteManifest: manifest });
  assert.equal(await dispatch(faultConfig, h.deps), 0);
  assert.equal(h.counts().claimCount, 0);
  assert.ok(h.counts().publishCount >= 1);
  assert.equal(h.remote().artifacts[0], manifest.artifacts[0]);
  assert.equal(
    h.published().find((candidate) => candidate.phase === 'working').lease.owner,
    '7001:33',
  );
});

test('dispatcher refuses a competing live remote lease', async () => {
  const manifest = faultManifest({
    lease: { owner: 'other-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() },
  });
  const h = faultHarness({ remoteManifest: manifest });
  await assert.rejects(
    () => dispatch(faultConfig, h.deps),
    (error) => error instanceof CliFailure && error.exitCode === 3,
  );
  assert.equal(h.counts().prepareCount, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentContractError, validateAgentEnvelope } from '../dist/agent-runner.js';
import {
  REMOTE_PROTOCOL,
  artifactKey,
  leaseIsActive,
  parseRunManifestMarker,
  projectRemoteState,
  reconcileArtifact,
  runManifestMarker,
  validateRunManifest,
} from '../dist/remote-state.js';

const context = { run: 'r', issue: 7, pr: 8, round: 1, sha: 'abcdef1', cursor: 'c' };
const guide = {
  summary: 'summary',
  steps: ['step'],
  expected: ['expected'],
  isolation: 'isolated',
  limitations: ['none'],
  checklist: ['checked'],
};

test('agent envelope accepts every producer contract and valid status family', () => {
  const worker = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'worker',
    status: 'blocked',
    payload: {
      summary: 's',
      findingResolutions: [{ id: 'Q1', status: 'fixed', summary: 's' }],
      verification: ['v'],
      guide,
    },
  };
  const reviewer = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'qa',
    status: 'accepted',
    payload: {
      summary: 's',
      evidence: ['e'],
      newFindings: [{ id: 'Q1', summary: 's', severity: 'low' }],
      dispositions: [{ id: 'Q1', status: 'fixed', summary: 's' }],
    },
  };
  const arbiter = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'arbiter',
    status: 'uphold',
    payload: { rationale: 'rationale', references: ['Q1'] },
  };
  assert.equal(validateAgentEnvelope(worker, context).status, 'blocked');
  assert.equal(
    validateAgentEnvelope({ ...reviewer, producer: 'staff', status: 'changes-requested' }, context)
      .producer,
    'staff',
  );
  assert.equal(validateAgentEnvelope(reviewer, context).status, 'accepted');
  assert.equal(validateAgentEnvelope(arbiter, context).status, 'uphold');
  for (const status of ['overrule', 'defer'])
    assert.equal(validateAgentEnvelope({ ...arbiter, status }, context).status, status);
});

test('agent envelope rejects each invalid contract boundary', () => {
  const base = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'arbiter',
    status: 'uphold',
    payload: { rationale: 'r', references: ['Q1'] },
  };
  for (const value of [
    null,
    { ...base, schema: 'v2' },
    { ...base, context: { ...context, issue: 0 } },
    { ...base, producer: 'other' },
    { ...base, status: 'other' },
    { ...base, payload: { rationale: '', references: ['Q1'] } },
    { ...base, payload: { rationale: 'r', references: [] } },
  ])
    assert.throws(() => validateAgentEnvelope(value, context), AgentContractError);
});

test('agent envelope rejects each role-specific invalid boundary', () => {
  const worker = {
    schema: 'sloop.agent-output/v1',
    context: { ...context, pr: undefined },
    producer: 'worker',
    status: 'ready',
    payload: { summary: 's', findingResolutions: [], verification: ['v'], guide },
  };
  const reviewer = {
    schema: 'sloop.agent-output/v1',
    context,
    producer: 'qa',
    status: 'accepted',
    payload: {
      summary: 's',
      evidence: ['e'],
      newFindings: [{ id: 'Q1', summary: 's', severity: 'low' }],
      dispositions: [{ id: 'Q1', status: 'fixed', summary: 's' }],
    },
  };
  assert.equal(validateAgentEnvelope(worker).context.pr, undefined);
  for (const value of [
    { ...worker, context: { ...worker.context, issue: 1.5 } },
    { ...worker, context: { ...worker.context, round: 0 } },
    { ...worker, context: { ...worker.context, pr: 0 } },
    { ...worker, context: { ...worker.context, pr: 1.5 } },
    { ...worker, status: 'accepted' },
    { ...worker, payload: { ...worker.payload, findingResolutions: ['not-a-record'] } },
    { ...worker, payload: { ...worker.payload, guide: { ...guide, steps: [] } } },
    { ...worker, payload: { ...worker.payload, guide: { ...guide, expected: [''] } } },
    { ...reviewer, status: 'ready' },
    {
      ...reviewer,
      payload: {
        ...reviewer.payload,
        dispositions: [{ id: 'missing', status: 'fixed', summary: 's' }],
      },
    },
    { ...reviewer, producer: 'arbiter', status: 'accepted' },
  ])
    assert.throws(() => validateAgentEnvelope(value), AgentContractError);
});

test('remote protocol projects idle, complete, review, and lease edge states', () => {
  const manifest = {
    protocol: REMOTE_PROTOCOL,
    runId: 'run',
    issue: 7,
    branch: 'codex/issue-7',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: ['key'],
  };
  const marker = runManifestMarker(manifest);
  assert.equal(parseRunManifestMarker(marker, 7).runId, 'run');
  assert.equal(parseRunManifestMarker('plain text', 7), undefined);
  assert.deepEqual(projectRemoteState({ issue: 7, markers: ['unrelated'] }).openGates, []);
  const review = projectRemoteState({
    issue: 7,
    markers: ['sloop/v1/run/run'],
    manifest,
    checks: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'failure', detailsUrl: 'url' }],
    reviews: [{ state: 'COMMENTED' }],
    inlineThreads: [{ resolved: false }],
    labels: ['Blocked'],
    branch: 'wrong',
    sha: 'wrong',
  });
  assert.equal(review.phase, 'review');
  assert.deepEqual(review.openGates, [
    'check:pr-checks',
    'review',
    'inline:1',
    'label:Blocked',
    'branch:mismatch',
    'sha:mismatch',
  ]);
  assert.equal(
    projectRemoteState({
      issue: 7,
      markers: ['sloop/v1/run/run'],
      manifest: { ...manifest, phase: 'complete' },
      branch: manifest.branch,
      sha: manifest.baseSha.slice(0, 7),
    }).phase,
    'complete',
  );
  assert.equal(leaseIsActive({ expiresAt: new Date(2).toISOString() }, 1), true);
  assert.equal(leaseIsActive({ expiresAt: new Date(1).toISOString() }, 1), false);
});

test('remote state validates durable records and canonical helper contracts', () => {
  const manifest = {
    protocol: REMOTE_PROTOCOL,
    runId: 'run',
    issue: 7,
    branch: 'codex/issue-7',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'working',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: [],
  };
  assert.equal(validateRunManifest(manifest, 7), true);
  for (const invalid of [
    undefined,
    { ...manifest, protocol: 2 },
    { ...manifest, runId: '' },
    { ...manifest, issue: 8 },
    { ...manifest, branch: '' },
    { ...manifest, baseSha: 'not-a-sha' },
    { ...manifest, configFingerprint: '' },
    { ...manifest, phase: 'unknown' },
    { ...manifest, reviewRound: 0 },
    { ...manifest, contextCursor: 1 },
    { ...manifest, artifacts: {} },
  ])
    assert.equal(validateRunManifest(invalid, 7), false);
  assert.equal(
    artifactKey('comment', { issue: 7, body: 'x' }),
    artifactKey('comment', { body: 'x', issue: 7 }),
  );
  assert.equal(reconcileArtifact(['key'], 'key'), true);
  assert.equal(reconcileArtifact(['key/next'], 'key'), true);
  assert.equal(reconcileArtifact(['other'], 'key'), false);
  assert.throws(() => leaseIsActive({ expiresAt: 'invalid' }), /invalid lease expiry/);
  assert.equal(parseRunManifestMarker('<!-- sloop/v1/manifest aW52YWxpZA -->', 7), undefined);
  assert.equal(parseRunManifestMarker(runManifestMarker({ ...manifest, issue: 8 }), 7), undefined);
});

test('remote state accounts for successful checks, matching refs, and lease ownership', () => {
  const manifest = {
    protocol: REMOTE_PROTOCOL,
    runId: 'run',
    issue: 7,
    branch: 'codex/issue-7',
    baseSha: 'abcdef1',
    configFingerprint: 'cfg',
    phase: 'claimed',
    reviewRound: 1,
    contextCursor: 'c',
    artifacts: ['sloop/v1/artifact/z'],
    lease: { owner: 'worker-a', expiresAt: new Date(2).toISOString() },
  };
  const projection = projectRemoteState({
    issue: 7,
    comments: [{ marker: 'sloop/v1/run/run' }, { marker: 'sloop/v1/artifact/a' }],
    manifest,
    checks: [{ name: 'green', status: 'COMPLETED', conclusion: 'success' }],
    reviews: [{ state: 'APPROVED' }, { state: 'DISMISSED' }],
    inlineThreads: [{ resolved: true }],
    labels: ['ordinary'],
    branch: manifest.branch,
    sha: manifest.baseSha,
    now: 1,
    leaseOwner: 'worker-b',
  });
  assert.equal(projection.phase, 'claimed');
  assert.deepEqual(projection.openGates, ['lease:owned']);
  assert.equal(projection.lease.active, true);
  assert.deepEqual(projection.artifactKeys, [
    'sloop/v1/artifact/a',
    'sloop/v1/artifact/z',
    'sloop/v1/run/run',
  ]);
  assert.deepEqual(
    projectRemoteState({
      issue: 7,
      markers: ['sloop/v1/run/run'],
      manifest: { ...manifest, lease: { owner: 'worker-a', expiresAt: new Date(1).toISOString() } },
      now: 1,
      leaseOwner: 'worker-a',
    }).openGates,
    [],
  );
  assert.deepEqual(projectRemoteState({ issue: 7, comments: [{}] }).artifactKeys, []);
  assert.equal(
    projectRemoteState({
      issue: 7,
      markers: ['sloop/v1/run/run'],
      manifest: {
        ...manifest,
        lease: { owner: 'worker-a', expiresAt: '2099-01-01T00:00:00.000Z' },
      },
    }).lease.active,
    true,
  );
  assert.throws(() => projectRemoteState({ issue: 0 }), /invalid issue/);
  assert.throws(() => projectRemoteState({ issue: 7, protocol: 2 }), /unsupported remote protocol/);
});

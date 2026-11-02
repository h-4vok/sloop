import { artifactKey } from '../../src/remote-state.js';

export const faultConfig = {
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

export function createFaultRunManifest(overrides = {}) {
  const runId = overrides.runId ?? 'fault-run';
  const key = artifactKey('run', { issue: 33, runId });
  const { omitPr = false, ...manifestOverrides } = overrides;
  return {
    protocol: 1,

    runId,

    issue: 33,

    branch: 'codex/issue-33-fault',

    baseSha: 'abcdef1',

    configFingerprint: 'config-fingerprint',

    phase: 'working',

    reviewRound: 1,

    contextCursor: 'cursor',

    artifacts: [key],

    ...(omitPr ? {} : { pr: 14 }),

    ...(manifestOverrides.lease ? { lease: manifestOverrides.lease } : {}),
  };
}

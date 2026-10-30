export function createArbiterFixtures() {
  const issue = {
    number: 41,

    title: 'Normalize surrounding whitespace in display names',

    body: 'Acceptance: normalize("  Ada  ") returns "Ada"; normalize("Ada") returns "Ada". Preserve internal spaces. Scope: string inputs only. No GitHub repository exists for this fictional issue.',
  };
  const pr = {
    number: 73,

    state: 'OPEN',

    baseRefName: 'main',

    headRefName: 'codex/issue-41',

    headRefOid: 'a'.repeat(40),

    body: 'Fictional implementation: normalize returns its input unchanged. Closes #41',

    mergeStateStatus: 'CLEAN',

    mergeable: 'MERGEABLE',

    comments: [],

    reviews: [],

    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  const config = {
    baseBranch: 'main',

    workerCommand: { command: 'mock-worker', args: [] },

    qaCommand: { command: 'mock-qa', args: [] },

    arbiterCommand: {
      command: 'codex',

      args: [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--model',
        'gpt-5.6-luna',
        '-c',
        'model_reasoning_effort=low',
      ],

      timeoutMs: 600_000,

      retries: 0,
    },

    arbiterReviewRounds: 3,

    arbiterStagnatingAppearances: 2,

    maxReviewRounds: 3,

    evidencePollIntervalMs: 0,

    evidenceTimeoutMs: 1000,

    checkPollIntervalMs: 0,

    checkTimeoutMs: 1000,
  };
  const context = {
    state: {},

    workers: 0,

    qa: 0,

    arbiterRuns: 0,

    issueComments: [],

    boundary: 'TEST_BOUNDARY: first Arbiter ruling consumed',
  };
  return { issue, pr, config, context };
}

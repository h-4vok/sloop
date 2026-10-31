export function createMockGitHubHost(respond) {
  const calls = [];
  return {
    calls,
    host: {
      platform: 'linux',
      pid: () => 123,
      now: () => 1_700_000_000_000,
      resolveExecutable: () => 'gh',
      runSyncCommand: (_command, args, _input, _platform, _comSpec, cwd) => {
        calls.push({ args, cwd });
        return respond(args, cwd);
      },
    },
  };
}

export function createReviewCapGitHubHost({ pullRequest, issue = { comments: [] } }) {
  const responses = new Map([
    ['api', 'octocat'],
    ['issue view', JSON.stringify(issue)],
    ['pr view', JSON.stringify(pullRequest)],
  ]);
  return createMockGitHubHost((args) => responses.get(mockGitHubCommandKey(args)) ?? '');
}

function mockGitHubCommandKey(args) {
  return args[0] === 'api' ? 'api' : args.slice(0, 2).join(' ');
}

export const baseConfig = {
  baseBranch: 'main',
  workerCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  staffReviewCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  qaCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
  requiredPrChecks: ['pr-checks'],
  checkPollIntervalMs: 0,
  checkTimeoutMs: 1000,
  evidencePollIntervalMs: 0,
  evidenceTimeoutMs: 1000,
  workerLeaseMs: 100,
  maxReviewRounds: 5,
};

export function createExistingHumanReviewGuide(commit = 'abc1') {
  return `[Human Review Guide] round=1 commit=${commit}\n<!-- sloop-dispatcher-human-review-guide -->\n\nSummary\nExercise the CLI change.\n\nSteps\n1. Run the focused command in a temporary directory.\n\nExpected results\n- The documented output appears.\n\nIsolation\nUse a temporary checkout and no credentials.\n\nLimitations / diagnostics\n- A failed command indicates the change is not ready.\n\nApproval checklist\n- [ ] Behavior matches the acceptance criteria.`;
}

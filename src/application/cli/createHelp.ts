const HELP_TEMPLATE = (version: string) => `Sloop ${version}

Usage: sloop <command> [option]

Configuration:
  config init            Create sloop.config.yaml with defaults
  config init --wizard   Configure sloop.config.yaml interactively
  config install [--force]
                         Install configured GitHub labels and Sloop skills

Read-only commands:
  status [--verbose] [--json]  Validate and show repository context
  issues list [--json]         List eligible issues
  doctor                       Run all runtime prerequisite checks

Options:
  --help                 Show this help
  --version              Show the installed version
  --recover-lock         Recover a stale dispatcher lock
  --reset                Reset completed local run state
  --prepare-recovery N [--pr PR]
                         Prepare issue N for worker recovery; use PR or existing state.pr
  --resolve-review-cap --steer TEXT [--additional-rounds N]
                         Record a human review-cap decision
                         [--waive Q1,Q2] [--waive-all-outstanding] [--abandon]
  --link-issue N         Link issue N to the active run
  --list-all-worktrees   List registered Sloop worktrees for this repository
  --clear-all-worktrees  Remove validated registered Sloop worktrees`;

// Creates the complete help text and command-specific usage output for this version.
export function createHelp(version: string): Readonly<{
  text: string;
  forTarget: (target: string) => string;
}> {
  const text = HELP_TEMPLATE(version);
  const usage: Record<string, string> = {
    status: 'Usage: sloop status [--verbose] [--json]',

    'issues list': 'Usage: sloop issues list [--json]',

    doctor: 'Usage: sloop doctor',

    '--recover-lock': 'Usage: sloop --recover-lock',

    '--reset': 'Usage: sloop --reset',

    '--prepare-recovery': 'Usage: sloop --prepare-recovery N [--pr N]',

    '--resolve-review-cap':
      'Usage: sloop --resolve-review-cap --steer <text> [--additional-rounds N] [--waive Q<n>,S<n>] [--waive-all-outstanding] [--abandon]',

    '--link-issue': 'Usage: sloop --link-issue N',
  };

  return {
    text,

    forTarget: (target) => usage[target] ?? text,
  };
}

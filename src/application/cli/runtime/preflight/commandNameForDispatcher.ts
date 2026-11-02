import type { DispatcherCommand } from '../../../dispatcher/DispatcherCommand.js';

/** Returns the CLI name displayed for a dispatcher command. */
export function commandNameForDispatcher(command: DispatcherCommand): string {
  const commandNames = {
    workflow: 'sloop',
    list: '--list',
    'recover-lock': '--recover-lock',
    reset: '--reset',
    'prepare-recovery': '--prepare-recovery',
    'resolve-review-cap': '--resolve-review-cap',
    'link-issue': '--link-issue',
    'list-all-worktrees': '--list-all-worktrees',
    'clear-all-worktrees': '--clear-all-worktrees',
    status: '--status',
  } satisfies Record<DispatcherCommand['kind'], string>;

  return commandNames[command.kind];
}

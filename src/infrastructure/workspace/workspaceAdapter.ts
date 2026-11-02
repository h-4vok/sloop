import { clearOwnedWorkspaces, cleanupOwnedWorkspace } from './lifecycle/clearOwnedWorkspaces.js';
import { listOwnedWorkspaces, reconcileBranch } from './lifecycle/discoverGitWorktrees.js';
import {
  prepareCheckoutWorkspace,
  prepareWorktreeWorkspace,
} from './lifecycle/prepareWorkerWorkspace.js';
import { recoverWorkerWorkspace } from './lifecycle/recoverWorkerWorkspace.js';
import type { WorkspaceFacts } from './WorkspaceFacts.js';

/** Compatibility facade for workspace lifecycle operations. */
export const workspaceAdapter = Object.freeze({
  reconcileBranch,

  prepareCheckoutWorkspace,

  prepareWorktreeWorkspace,

  recoverWorkspace: recoverWorkerWorkspace,

  listWorkspaces: listOwnedWorkspaces,

  clearWorkspaces: clearOwnedWorkspaces,

  cleanupWorkspace: cleanupOwnedWorkspace,
});

export type { WorkspaceFacts };

import { workspaceAdapter } from './infrastructure/workspace/workspaceAdapter.js';

export { workspaceAdapter } from './infrastructure/workspace/workspaceAdapter.js';
export type { BranchReconciliation } from './infrastructure/workspace/BranchReconciliation.js';
export type { WorkspaceFacts } from './infrastructure/workspace/WorkspaceFacts.js';
export type { WorkspaceOptions } from './infrastructure/workspace/WorkspaceOptions.js';

// Preserve the original named API for callers outside infrastructure.
export const reconcileBranch = workspaceAdapter.reconcileBranch;
export const prepareCheckoutWorkspace = workspaceAdapter.prepareCheckoutWorkspace;
export const prepareWorktreeWorkspace = workspaceAdapter.prepareWorktreeWorkspace;
export const recoverWorkspace = workspaceAdapter.recoverWorkspace;
export const listWorkspaces = workspaceAdapter.listWorkspaces;
export const clearWorkspaces = workspaceAdapter.clearWorkspaces;
export const cleanupWorkspace = workspaceAdapter.cleanupWorkspace;

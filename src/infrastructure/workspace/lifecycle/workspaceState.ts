import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { WorkspaceFacts } from '../WorkspaceFacts.js';

/** Persisted registration fields retained across workspace lifecycle transitions. */
export type RegisteredWorkspace = WorkspaceFacts & {
  repositoryRoot: string;
  worktreeRoot?: string;
  pr?: number;
  orphaned?: boolean;
};

/** A Git worktree as reported by `git worktree list --porcelain`. */
export type GitWorktree = { path: string; head: string; branch?: string };

/** Run Git and return trimmed text output from the requested repository. */
export const runGit = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Ensure a target is a strict descendant of its configured root. */
export const isInside = (root: string, target: string): boolean => {
  const relativePath = relative(resolve(root), resolve(target));
  const parentPrefix = process.platform === 'win32' ? '..\\' : '../';
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(parentPrefix) &&
    !isAbsolute(relativePath)
  );
};

/** Read registrations conservatively; malformed state yields no owned entries. */
export const readWorkspaceState = (file: string): RegisteredWorkspace[] => {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      workspaces?: RegisteredWorkspace[];
    };
    return Array.isArray(state.workspaces) ? state.workspaces : [];
  } catch {
    return [];
  }
};

/** Atomically replace workspace registrations after a lifecycle change. */
export const writeWorkspaceState = (file: string, entries: RegisteredWorkspace[]): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify({ workspaces: entries }, null, 2)}\n`);
  renameSync(temporaryFile, file);
};

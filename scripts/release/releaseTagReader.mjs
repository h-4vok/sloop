import { execFileSync } from 'node:child_process';

/** Runs a git read command from the repository checked out by the workflow. */
export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Reads release tags in semver order for the next-version calculation. */
export function gitTags(gitCommand = git) {
  return gitCommand('tag', '--list', 'v*', '--sort=-version:refname').split('\n').filter(Boolean);
}

/** Reads the package and changelog content recorded by a release tag. */
export function readTagMetadata(tag, gitCommand = git) {
  try {
    return {
      packageText: gitCommand('show', `${tag}:package.json`),
      changelog: gitCommand('show', `${tag}:CHANGELOG.md`),
    };
  } catch {
    return null;
  }
}

/** Resolves the commit targeted by a release tag, returning null for a missing tag. */
export function readTagTarget(tag, gitCommand = git) {
  try {
    return gitCommand('rev-list', '-n1', tag);
  } catch {
    return null;
  }
}

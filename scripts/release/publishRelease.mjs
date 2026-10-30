import { readFileSync } from 'node:fs';
import {
  hasReleaseMetadata,
  updateRepositoryMetadata,
  verifyReleaseState,
} from '../../dist/release.js';
import { git, readTagTarget } from './releaseTagReader.mjs';

/** Reuses a matching release or creates one when the tag has no release. */
export async function reuseOrCreateRelease(api, tag, tagTarget) {
  const existing = await api.releaseByTag(tag);
  if (!existing) {
    await api.createRelease(tag);

    return 'created';
  }

  verifyReleaseState(
    {
      tagName: tag,
      tagTarget,
      releaseTagName: existing.tagName,
      releaseTarget: existing.targetCommitish,
    },
    tag,
    tagTarget,
  );

  return 'reused';
}

async function publishNewRelease({
  api,
  tag,
  version,
  pr,
  date,
  gitCommand,
  readFile,
  updateMetadata,
}) {
  const packageText = readFile('package.json', 'utf8');
  const changelog = readFile('CHANGELOG.md', 'utf8');
  if (!hasReleaseMetadata(packageText, changelog, version, date, pr))
    updateMetadata(version, date, pr);

  gitCommand('config', 'user.name', 'github-actions[bot]');
  gitCommand('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  gitCommand('add', 'package.json', 'CHANGELOG.md');
  try {
    gitCommand('diff', '--cached', '--quiet');
  } catch {
    gitCommand('commit', '-m', `chore(release): ${tag}`);
  }
  gitCommand('tag', tag);
  gitCommand('push', 'origin', 'main', tag);
  await api.createRelease(tag);

  return 'published';
}

/** Publishes metadata and a tag, or verifies and reuses an existing tag. */
export async function publishRelease({
  api,
  version,
  pr,
  date,
  gitCommand = git,
  readFile = readFileSync,
  updateMetadata = updateRepositoryMetadata,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !Number.isSafeInteger(pr) || pr < 1)
    throw new Error('Missing release version or PR number');

  const tag = `v${version}`;
  const target = readTagTarget(tag, gitCommand);
  if (target) return reuseOrCreateRelease(api, tag, target);

  return publishNewRelease({ api, tag, version, pr, date, gitCommand, readFile, updateMetadata });
}

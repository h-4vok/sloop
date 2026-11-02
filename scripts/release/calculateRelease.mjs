import { deriveReleaseKind, hasReleaseMetadata, nextVersion } from '../../dist/release.js';
import { resolveIssueTitles } from './resolveIssueTitles.mjs';

function existingVersionForPr(tags, prNumber, readTagMetadata) {
  for (const tag of tags) {
    const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) continue;

    const metadata = readTagMetadata(tag);
    if (
      metadata &&
      hasReleaseMetadata(metadata.packageText, metadata.changelog, match[1], '', prNumber)
    )
      return match[1];
  }

  return null;
}

/** Calculates a semver release from linked issue titles and existing release tags. */
export async function calculateRelease({
  api,
  number,
  body,
  tags,
  readTagMetadata,
  packageVersion,
  warn,
}) {
  const titles = await resolveIssueTitles(api, number, body, warn);
  const kind = deriveReleaseKind(titles);
  const existing = existingVersionForPr(tags, number, readTagMetadata);
  const latestTag = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const latestVersion = latestTag?.slice(1) ?? packageVersion;

  return { kind, version: existing ?? nextVersion(latestVersion, kind), reused: Boolean(existing) };
}

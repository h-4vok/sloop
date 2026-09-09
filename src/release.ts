import { readFileSync, writeFileSync } from 'node:fs';

export type ReleaseKind = 'patch' | 'minor' | 'major' | 'none';

export function parseReleaseKind(title: string): ReleaseKind {
  const match = title.match(/^\[([^\]]+)\](?:\s|$)/);
  const hasSecondPrefix = /^\[[^\]]+\]/.test(title.slice(match?.[0].length ?? 0).trimStart());
  if (!match || hasSecondPrefix || !['patch', 'minor', 'major', 'none'].includes(match[1])) {
    throw new Error(
      'Merged PR title must begin with exactly one of [patch], [minor], [major], or [none].',
    );
  }
  return match[1] as ReleaseKind;
}

export function nextVersion(current: string, kind: ReleaseKind): string {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Latest release tag is not SemVer: ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === 'none') return current;
  if (kind === 'major') return major === 0 ? '1.0.0' : `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function updateMetadata(
  packageText: string,
  changelog: string,
  version: string,
  date: string,
  pr: number,
): { packageText: string; changelog: string } {
  const pkg = JSON.parse(packageText) as { version?: string };
  pkg.version = version;
  const updatedPackage = `${JSON.stringify(pkg, null, 2)}\n`;
  const entry = `## ${version} - ${date}\n\n- Merged pull request #${pr}.\n\n`;
  return {
    packageText: updatedPackage,
    changelog: `${entry}${changelog.replace(/^# Changelog\s*\n?/, '# Changelog\n\n')}`,
  };
}

export function updateRepositoryMetadata(version: string, date: string, pr: number): void {
  const result = updateMetadata(
    readFileSync('package.json', 'utf8'),
    readFileSync('CHANGELOG.md', 'utf8'),
    version,
    date,
    pr,
  );
  writeFileSync('package.json', result.packageText);
  writeFileSync('CHANGELOG.md', result.changelog);
}

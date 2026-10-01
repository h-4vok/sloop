import { readFileSync, writeFileSync } from 'node:fs';

export type ReleaseKind = 'patch' | 'minor' | 'major' | 'none';

export type ReleaseState = {
  tagName: string;
  tagTarget: string;
  releaseTagName: string;
  releaseTarget: string;
};

export type ReleaseFiles = Readonly<{
  readFile: (file: string, encoding: BufferEncoding) => string;
  writeFile: (file: string, content: string) => void;
}>;

const productionReleaseFiles: ReleaseFiles = { readFile: readFileSync, writeFile: writeFileSync };

export function parseIssueReleaseKind(title: string): Exclude<ReleaseKind, 'none'> | null {
  const match = title.match(/^\[(patch|minor|major)\](?:\s|$)/);
  const hasSecondPrefix = /^\[[^\]]+\]/.test(title.slice(match?.[0].length ?? 0).trimStart());
  if (hasSecondPrefix) return null;
  return match ? (match[1] as Exclude<ReleaseKind, 'none'>) : null;
}

export function deriveReleaseKind(issueTitles: readonly string[]): Exclude<ReleaseKind, 'none'> {
  const rank = { patch: 1, minor: 2, major: 3 } as const;
  return issueTitles.reduce<Exclude<ReleaseKind, 'none'>>((best, title) => {
    const kind = parseIssueReleaseKind(title);
    return kind && rank[kind] > rank[best] ? kind : best;
  }, 'minor');
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

export function verifyReleaseState(
  state: ReleaseState,
  expectedTag: string,
  expectedTarget: string,
): void {
  if (state.tagName !== expectedTag || state.tagTarget !== expectedTarget) {
    throw new Error(`Existing ${expectedTag} tag does not point at ${expectedTarget}.`);
  }
  if (
    state.releaseTagName !== expectedTag ||
    ![expectedTarget, 'main'].includes(state.releaseTarget)
  ) {
    throw new Error(
      `Existing release for ${expectedTag} does not match tag target ${expectedTarget}.`,
    );
  }
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

export function hasReleaseMetadata(
  packageText: string,
  changelog: string,
  version: string,
  _date: string,
  pr: number,
): boolean {
  const pkg = JSON.parse(packageText) as { version?: string };
  const match = changelog.match(
    /^## ([^ ]+) - (\d{4}-\d{2}-\d{2})\n\n- Merged pull request #(\d+)\./,
  );
  return pkg.version === version && match?.[1] === version && Number(match[3]) === pr;
}

export function updateRepositoryMetadata(
  version: string,
  date: string,
  pr: number,
  files: ReleaseFiles = productionReleaseFiles,
): void {
  const result = updateMetadata(
    files.readFile('package.json', 'utf8'),
    files.readFile('CHANGELOG.md', 'utf8'),
    version,
    date,
    pr,
  );
  files.writeFile('package.json', result.packageText);
  files.writeFile('CHANGELOG.md', result.changelog);
}

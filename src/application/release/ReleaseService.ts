/** Release planning and metadata rules, independent of filesystem access. */
export type ReleaseKind = 'patch' | 'minor' | 'major' | 'none';

/** Tag and release targets used to validate an existing publication. */
export type ReleaseState = Readonly<{
  tagName: string;
  tagTarget: string;
  releaseTagName: string;
  releaseTarget: string;
}>;

/** Parses one supported release prefix, rejecting stacked classifications. */
export function parseIssueReleaseKind(title: string): Exclude<ReleaseKind, 'none'> | null {
  const match = title.match(/^\[(patch|minor|major)\](?:\s|$)/);
  const hasSecondPrefix = /^\[[^\]]+\]/.test(title.slice(match?.[0].length ?? 0).trimStart());
  if (hasSecondPrefix) return null;
  return match ? (match[1] as Exclude<ReleaseKind, 'none'>) : null;
}

/** Chooses the highest requested release kind, defaulting to minor. */
export function deriveReleaseKind(issueTitles: readonly string[]): Exclude<ReleaseKind, 'none'> {
  const rank = { patch: 1, minor: 2, major: 3 } as const;
  const best = issueTitles.reduce<Exclude<ReleaseKind, 'none'> | null>((currentBest, title) => {
    const kind = parseIssueReleaseKind(title);
    return kind && (!currentBest || rank[kind] > rank[currentBest]) ? kind : currentBest;
  }, null);

  return best ?? 'minor';
}

/** Calculates the next version according to the requested release kind. */
export function nextVersion(current: string, kind: ReleaseKind): string {
  const [major, minor, patch] = parseVersionParts(current);
  switch (kind) {
    case 'none':
      return current;
    case 'major':
      return incrementMajorVersion(major);
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function parseVersionParts(current: string): number[] {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Latest release tag is not SemVer: ${current}`);
  return match.slice(1).map(Number);
}

function incrementMajorVersion(major: number): string {
  return major === 0 ? '1.0.0' : `${major + 1}.0.0`;
}

/** Rejects an existing GitHub publication that points to another target. */
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

/** Updates package and changelog text without performing filesystem access. */
export function updateMetadata(
  packageText: string,
  changelog: string,
  version: string,
  date: string,
  pr: number,
): Readonly<{ packageText: string; changelog: string }> {
  const pkg = JSON.parse(packageText) as { version?: string };
  pkg.version = version;
  const updatedPackage = `${JSON.stringify(pkg, null, 2)}\n`;
  const entry = `## ${version} - ${date}\n\n- Merged pull request #${pr}.\n\n`;

  return {
    packageText: updatedPackage,
    changelog: `${entry}${changelog.replace(/^# Changelog\s*\n?/, '# Changelog\n\n')}`,
  };
}

/** Checks whether package and changelog text already describe this release. */
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

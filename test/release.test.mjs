import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  parseIssueReleaseKind,
  deriveReleaseKind,
  nextVersion,
  updateMetadata,
  hasReleaseMetadata,
  verifyReleaseState,
  updateRepositoryMetadata,
} from '../src/release.js';
import {
  deriveReleaseKind as serviceDeriveReleaseKind,
  nextVersion as serviceNextVersion,
  parseIssueReleaseKind as serviceParseIssueReleaseKind,
} from '../src/application/release/index.js';
import { updateRepositoryMetadata as infrastructureUpdateMetadata } from '../src/infrastructure/release/updateRepositoryMetadata.js';

test('release root preserves the public service and filesystem adapter imports', () => {
  assert.equal(parseIssueReleaseKind, serviceParseIssueReleaseKind);
  assert.equal(deriveReleaseKind, serviceDeriveReleaseKind);
  assert.equal(nextVersion, serviceNextVersion);
  assert.equal(updateRepositoryMetadata, infrastructureUpdateMetadata);
});

test('parses only exact issue release prefixes', () => {
  const recognizedTitles = ['[patch] fix', '[minor] feature', '[major] breaking'];
  const unrecognizedTitles = [
    'fix',
    '[Patch] fix',
    '[none] docs',
    '[patch] [minor] fix',
    '[unknown] fix',
  ];

  const recognizedKinds = recognizedTitles.map(parseIssueReleaseKind);
  const rejectedKinds = unrecognizedTitles.map(parseIssueReleaseKind);

  assert.deepEqual(recognizedKinds, ['patch', 'minor', 'major']);
  assert.deepEqual(rejectedKinds, [null, null, null, null, null]);
});

test('derives the highest issue bump independent of order and defaults to minor', () => {
  const issueTitleGroups = [
    ['[patch] fix'],
    ['[patch] fix', 'unclassified'],
    ['[patch] fix', '[major] break', '[minor] feature'],
    ['[major] break', '[patch] fix'],
    ['fix', '[none] docs'],
    [],
  ];

  const derivedKinds = issueTitleGroups.map(deriveReleaseKind);

  assert.deepEqual(derivedKinds, ['patch', 'patch', 'major', 'major', 'minor', 'minor']);
});

test('calculates patch, minor, and major SemVer bumps', () => {
  const versionBumps = [
    ['0.1.1', 'patch'],
    ['0.1.1', 'minor'],
    ['1.2.3', 'major'],
  ];

  const versions = versionBumps.map(([version, kind]) => nextVersion(version, kind));

  assert.deepEqual(versions, ['0.1.2', '0.2.0', '2.0.0']);
});

test('calculates a 0.x major bump as 1.0.0', () => {
  const version = nextVersion('0.9.9', 'major');

  assert.equal(version, '1.0.0');
});

test('rejects an invalid current SemVer version', () => {
  const invalidVersion = 'not-a-version';

  const calculateInvalidVersion = () => nextVersion(invalidVersion, 'patch');

  assert.throws(calculateInvalidVersion, /not SemVer/);
});

test('updates package metadata and changelog with PR reference', () => {
  const result = updateMetadata(
    '{"name":"sloop","version":"0.1.1"}\n',
    '# Changelog\n\nold\n',
    '0.1.2',
    '2026-09-09',
    72,
  );

  assert.equal(JSON.parse(result.packageText).version, '0.1.2');
  assert.match(result.changelog, /## 0\.1\.2 - 2026-09-09/);
  assert.match(result.changelog, /#72/);
});

test('recognizes metadata already committed after a partial publication push', () => {
  const result = updateMetadata(
    '{"name":"sloop","version":"0.1.1"}\n',
    '# Changelog\n\nold\n',
    '0.1.2',
    '2026-09-10',
    72,
  );

  const matchingPublication = hasReleaseMetadata(
    result.packageText,
    result.changelog,
    '0.1.2',
    '2026-09-10',
    72,
  );
  const samePublicationDate = hasReleaseMetadata(
    result.packageText,
    result.changelog,
    '0.1.2',
    '2026-09-11',
    72,
  );
  const differentPullRequest = hasReleaseMetadata(
    result.packageText,
    result.changelog,
    '0.1.2',
    '2026-09-10',
    73,
  );
  const oldPackageVersion = hasReleaseMetadata(
    '{"version":"0.1.1"}',
    result.changelog,
    '0.1.2',
    '2026-09-10',
    72,
  );
  const missingChangelogEntry = hasReleaseMetadata(
    '{"version":"0.1.2"}',
    '# Changelog\n',
    '0.1.2',
    '2026-09-10',
    72,
  );

  assert.deepEqual(
    [
      matchingPublication,
      samePublicationDate,
      differentPullRequest,
      oldPackageVersion,
      missingChangelogEntry,
    ],
    [true, true, false, false, false],
  );
});

test('accepts matching tag and release targets', () => {
  const state = {
    tagName: 'v0.1.2',

    tagTarget: 'abc123',

    releaseTagName: 'v0.1.2',

    releaseTarget: 'abc123',
  };

  const verifyMatchingTargets = () => verifyReleaseState(state, 'v0.1.2', 'abc123');

  assert.doesNotThrow(verifyMatchingTargets);
});

test('accepts an existing release that points to the current branch', () => {
  const state = {
    tagName: 'v0.1.2',

    tagTarget: 'abc123',

    releaseTagName: 'v0.1.2',

    releaseTarget: 'abc123',
  };

  const verifyBranchTarget = () =>
    verifyReleaseState({ ...state, releaseTarget: 'main' }, 'v0.1.2', 'abc123');

  assert.doesNotThrow(verifyBranchTarget);
});

test('rejects an existing tag that points to a different commit', () => {
  const state = {
    tagName: 'v0.1.2',

    tagTarget: 'different',

    releaseTagName: 'v0.1.2',

    releaseTarget: 'abc123',
  };

  const verifyMismatchedTag = () => verifyReleaseState(state, 'v0.1.2', 'abc123');

  assert.throws(verifyMismatchedTag);
});

test('rejects a release with a different tag name', () => {
  const state = {
    tagName: 'v0.1.2',

    tagTarget: 'abc123',

    releaseTagName: 'v0.1.3',

    releaseTarget: 'abc123',
  };

  const verifyMismatchedReleaseTag = () => verifyReleaseState(state, 'v0.1.2', 'abc123');

  assert.throws(verifyMismatchedReleaseTag);
});

test('rejects a release that points to a different commit', () => {
  const state = {
    tagName: 'v0.1.2',

    tagTarget: 'abc123',

    releaseTagName: 'v0.1.2',

    releaseTarget: 'different',
  };

  const verifyMismatchedRelease = () => verifyReleaseState(state, 'v0.1.2', 'abc123');

  assert.throws(verifyMismatchedRelease);
});

test('merged-PR workflow runs the tested API helper with the built-in token', () => {
  const workflow = parseYaml(readFileSync('.github/workflows/release.yml', 'utf8'));
  const steps = workflow.jobs.release.steps;

  assert.deepEqual(workflow.on.pull_request.types, ['closed']);
  assert.equal(workflow.jobs.release.if, 'github.event.pull_request.merged == true');
  assert.equal(workflow.permissions.issues, 'read');
  assert.equal(
    steps.find((step) => step.name === 'Calculate release').run,
    'node scripts/release-workflow.mjs calculate',
  );
  assert.equal(
    steps.find((step) => step.name === 'Publish release metadata').run,
    'node scripts/release-workflow.mjs publish',
  );
  assert.equal(
    steps.find((step) => step.name === 'Calculate release').env.GITHUB_TOKEN,
    '${{ github.token }}',
  );
  assert.equal(
    steps.find((step) => step.name === 'Publish release metadata').env.GITHUB_TOKEN,
    '${{ github.token }}',
  );
});

test('repository metadata writer reads and updates only the release files through its file seam', () => {
  const writes = new Map();

  updateRepositoryMetadata('0.1.2', '2026-09-11', 95, {
    readFile: (file) =>
      file === 'package.json'
        ? '{"name":"sloop","version":"0.1.1"}\n'
        : '# Changelog\n\nprevious\n',

    writeFile: (file, content) => writes.set(file, content),
  });

  assert.equal(JSON.parse(writes.get('package.json')).version, '0.1.2');
  assert.match(writes.get('CHANGELOG.md'), /Merged pull request #95/);
});

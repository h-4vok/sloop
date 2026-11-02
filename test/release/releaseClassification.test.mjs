import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deriveReleaseKind, nextVersion, parseIssueReleaseKind } from '../../src/release.js';

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

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hasReleaseMetadata, updateMetadata } from '../../src/release.js';

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

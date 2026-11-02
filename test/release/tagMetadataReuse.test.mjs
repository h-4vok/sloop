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

const releaseMetadataCases = [
  { name: 'matching publication', date: '2026-09-10', pullRequest: 72, expected: true },
  { name: 'another publication date', date: '2026-09-11', pullRequest: 72, expected: true },
  { name: 'different pull request', date: '2026-09-10', pullRequest: 73, expected: false },
  {
    name: 'outdated package version',
    date: '2026-09-10',
    pullRequest: 72,
    packageText: '{"version":"0.1.1"}',
    expected: false,
  },
  {
    name: 'missing changelog entry',
    date: '2026-09-10',
    pullRequest: 72,
    changelog: '# Changelog\n',
    expected: false,
  },
];

test.each(releaseMetadataCases)(
  'recognizes $name after partial publication',
  ({ date, pullRequest, packageText, changelog, expected }) => {
    const publication = updateMetadata(
      '{"name":"sloop","version":"0.1.1"}\n',
      '# Changelog\n\nold\n',
      '0.1.2',
      '2026-09-10',
      72,
    );

    assert.equal(
      hasReleaseMetadata(
        packageText ?? publication.packageText,
        changelog ?? publication.changelog,
        '0.1.2',
        date,
        pullRequest,
      ),
      expected,
    );
  },
);

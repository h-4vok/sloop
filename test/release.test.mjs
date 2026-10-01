import test from 'node:test';
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

test('parses only exact issue release prefixes', () => {
  assert.equal(parseIssueReleaseKind('[patch] fix'), 'patch');
  assert.equal(parseIssueReleaseKind('[minor] feature'), 'minor');
  assert.equal(parseIssueReleaseKind('[major] breaking'), 'major');
  for (const title of ['fix', '[Patch] fix', '[none] docs', '[patch] [minor] fix', '[unknown] fix'])
    assert.equal(parseIssueReleaseKind(title), null);
});

test('derives the highest issue bump independent of order and defaults to minor', () => {
  assert.equal(deriveReleaseKind(['[patch] fix']), 'patch');
  assert.equal(deriveReleaseKind(['[patch] fix', 'unclassified']), 'patch');
  assert.equal(deriveReleaseKind(['[patch] fix', '[major] break', '[minor] feature']), 'major');
  assert.equal(deriveReleaseKind(['[major] break', '[patch] fix']), 'major');
  assert.equal(deriveReleaseKind(['fix', '[none] docs']), 'minor');
  assert.equal(deriveReleaseKind([]), 'minor');
});

test('calculates all SemVer bumps including 0.x major', () => {
  assert.equal(nextVersion('0.1.1', 'patch'), '0.1.2');
  assert.equal(nextVersion('0.1.1', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.9.9', 'major'), '1.0.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => nextVersion('not-a-version', 'patch'), /not SemVer/);
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
  assert.equal(
    hasReleaseMetadata(result.packageText, result.changelog, '0.1.2', '2026-09-10', 72),
    true,
  );
  assert.equal(
    hasReleaseMetadata(result.packageText, result.changelog, '0.1.2', '2026-09-11', 72),
    true,
  );
  assert.equal(
    hasReleaseMetadata(result.packageText, result.changelog, '0.1.2', '2026-09-10', 73),
    false,
  );
  assert.equal(
    hasReleaseMetadata('{"version":"0.1.1"}', result.changelog, '0.1.2', '2026-09-10', 72),
    false,
  );
  assert.equal(
    hasReleaseMetadata('{"version":"0.1.2"}', '# Changelog\n', '0.1.2', '2026-09-10', 72),
    false,
  );
});

test('verifies an existing tag and release are idempotently consistent', () => {
  const state = {
    tagName: 'v0.1.2',
    tagTarget: 'abc123',
    releaseTagName: 'v0.1.2',
    releaseTarget: 'abc123',
  };
  assert.doesNotThrow(() => verifyReleaseState(state, 'v0.1.2', 'abc123'));
  assert.doesNotThrow(() =>
    verifyReleaseState({ ...state, releaseTarget: 'main' }, 'v0.1.2', 'abc123'),
  );
  for (const changed of [
    { ...state, tagTarget: 'different' },
    { ...state, releaseTagName: 'v0.1.3' },
    { ...state, releaseTarget: 'different' },
  ])
    assert.throws(() => verifyReleaseState(changed, 'v0.1.2', 'abc123'));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReleaseKind,
  nextVersion,
  updateMetadata,
  verifyReleaseState,
} from '../dist/release.js';

test('parses exact release prefixes and rejects ambiguous titles', () => {
  assert.equal(parseReleaseKind('[patch] fix'), 'patch');
  assert.equal(parseReleaseKind('[none] docs'), 'none');
  for (const title of ['fix', '[Patch] fix', '[patch] [minor] fix', '[unknown] fix'])
    assert.throws(() => parseReleaseKind(title));
});

test('calculates all SemVer bumps including 0.x major', () => {
  assert.equal(nextVersion('0.1.1', 'patch'), '0.1.2');
  assert.equal(nextVersion('0.1.1', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.9.9', 'major'), '1.0.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', 'none'), '1.2.3');
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

test('verifies an existing tag and release are idempotently consistent', () => {
  const state = {
    tagName: 'v0.1.2',
    tagTarget: 'abc123',
    releaseTagName: 'v0.1.2',
    releaseTarget: 'abc123',
  };
  assert.doesNotThrow(() => verifyReleaseState(state, 'v0.1.2', 'abc123'));
  for (const changed of [
    { ...state, tagTarget: 'different' },
    { ...state, releaseTagName: 'v0.1.3' },
    { ...state, releaseTarget: 'different' },
  ])
    assert.throws(() => verifyReleaseState(changed, 'v0.1.2', 'abc123'));
});

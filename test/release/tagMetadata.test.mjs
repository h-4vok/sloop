import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hasReleaseMetadata, updateMetadata, verifyReleaseState } from '../../src/release.js';

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

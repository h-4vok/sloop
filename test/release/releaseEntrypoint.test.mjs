import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  parseIssueReleaseKind,
  deriveReleaseKind,
  nextVersion,
  updateRepositoryMetadata,
} from '../../src/release.js';
import {
  deriveReleaseKind as serviceDeriveReleaseKind,
  nextVersion as serviceNextVersion,
  parseIssueReleaseKind as serviceParseIssueReleaseKind,
} from '../../src/application/release/index.js';
import { updateRepositoryMetadata as infrastructureUpdateMetadata } from '../../src/infrastructure/release/updateRepositoryMetadata.js';

test('release root preserves the public service and filesystem adapter imports', () => {
  assert.equal(parseIssueReleaseKind, serviceParseIssueReleaseKind);
  assert.equal(deriveReleaseKind, serviceDeriveReleaseKind);
  assert.equal(nextVersion, serviceNextVersion);
  assert.equal(updateRepositoryMetadata, infrastructureUpdateMetadata);
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

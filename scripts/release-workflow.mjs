import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calculateRelease } from './release/calculateRelease.mjs';
import { createGitHubApi } from './release/createGitHubApi.mjs';
import { publishRelease, reuseOrCreateRelease } from './release/publishRelease.mjs';
import { gitTags, readTagMetadata } from './release/releaseTagReader.mjs';
import { closingIssueNumbers, resolveIssueTitles } from './release/resolveIssueTitles.mjs';

export {
  calculateRelease,
  closingIssueNumbers,
  createGitHubApi,
  publishRelease,
  resolveIssueTitles,
  reuseOrCreateRelease,
};

async function main() {
  const command = process.argv[2];
  const api = createGitHubApi({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY ?? '',
    apiUrl: process.env.GITHUB_API_URL,
  });

  if (command === 'calculate') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const number = event.pull_request?.number;
    if (!Number.isSafeInteger(number)) throw new Error('Missing merged PR number');

    const result = await calculateRelease({
      api,
      number,
      body: event.pull_request.body,
      tags: gitTags(),
      readTagMetadata,
      packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    });
    appendFileSync(process.env.GITHUB_OUTPUT, `kind=${result.kind}\nversion=${result.version}\n`);
    console.log(
      `Release for PR #${number}: ${result.kind} -> v${result.version}${result.reused ? ' (existing)' : ''}`,
    );
    return;
  }

  if (command === 'publish') {
    const outcome = await publishRelease({
      api,
      version: process.env.VERSION,
      pr: Number(process.env.PR_NUMBER),
      date: new Date().toISOString().slice(0, 10),
    });
    console.log(`Release v${process.env.VERSION} for PR #${process.env.PR_NUMBER}: ${outcome}.`);
    return;
  }

  throw new Error('Usage: node scripts/release-workflow.mjs calculate|publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

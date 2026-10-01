import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  deriveReleaseKind,
  hasReleaseMetadata,
  nextVersion,
  updateRepositoryMetadata,
  verifyReleaseState,
} from '../dist/release.js';

const closingIssuesQuery = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 100, after: $after) {
          nodes { title }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export function closingIssueNumbers(body) {
  return [
    ...new Set([...body.matchAll(/\bcloses?\s+#(\d+)\b/gi)].map((match) => Number(match[1]))),
  ];
}

export function createGitHubApi({
  token,
  repository,
  fetchImpl = fetch,
  apiUrl = 'https://api.github.com',
}) {
  if (!token) throw new Error('GITHUB_TOKEN is required for release API calls');
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  const base = apiUrl.replace(/\/$/, '');
  async function request(path, { method = 'GET', body, missingIsNull = false } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'sloop-release',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (missingIsNull && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`GitHub API ${method} ${path} failed: HTTP ${response.status}`);
    const value = await response.json();
    if (value.errors?.length)
      throw new Error(`GitHub GraphQL query failed: ${value.errors[0].message}`);
    return value;
  }
  return {
    async closingIssueTitles(number) {
      const titles = [];
      let after = null;
      do {
        const result = await request('/graphql', {
          method: 'POST',
          body: { query: closingIssuesQuery, variables: { owner, repo, number, after } },
        });
        const connection = result.data?.repository?.pullRequest?.closingIssuesReferences;
        if (!connection) throw new Error('GitHub returned no closing-issues list');
        titles.push(...(connection.nodes ?? []).map((issue) => issue?.title).filter(Boolean));
        after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
        if (connection.pageInfo?.hasNextPage && !after)
          throw new Error('GitHub returned a closing-issues page without a cursor');
      } while (after);
      return titles;
    },
    async issueTitle(number) {
      const issue = await request(`/repos/${owner}/${repo}/issues/${number}`, {
        missingIsNull: true,
      });
      return issue?.title ?? null;
    },
    async releaseByTag(tag) {
      const release = await request(
        `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
        {
          missingIsNull: true,
        },
      );
      return release
        ? { tagName: release.tag_name, targetCommitish: release.target_commitish }
        : null;
    },
    async createRelease(tag) {
      return request(`/repos/${owner}/${repo}/releases`, {
        method: 'POST',
        body: { tag_name: tag, name: tag, generate_release_notes: true },
      });
    },
  };
}

export async function resolveIssueTitles(api, number, body, warn = console.warn) {
  try {
    const linked = await api.closingIssueTitles(number);
    if (linked.length) return linked;
  } catch (error) {
    warn(`Closing-issue lookup failed; trying PR body: ${error.message}`);
  }
  const titles = [];
  for (const issueNumber of closingIssueNumbers(body ?? '')) {
    try {
      const title = await api.issueTitle(issueNumber);
      if (title) titles.push(title);
    } catch (error) {
      warn(`Issue #${issueNumber} lookup failed; skipping: ${error.message}`);
    }
  }
  return titles;
}

export function existingVersionForPr(tags, prNumber, readTagMetadata) {
  for (const tag of tags) {
    const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) continue;
    const metadata = readTagMetadata(tag);
    if (
      metadata &&
      hasReleaseMetadata(metadata.packageText, metadata.changelog, match[1], '', prNumber)
    )
      return match[1];
  }
  return null;
}

export async function calculateRelease({
  api,
  number,
  body,
  tags,
  readTagMetadata,
  packageVersion,
  warn,
}) {
  const titles = await resolveIssueTitles(api, number, body, warn);
  const kind = deriveReleaseKind(titles);
  const existing = existingVersionForPr(tags, number, readTagMetadata);
  const latest = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))?.slice(1) ?? packageVersion;
  return { kind, version: existing ?? nextVersion(latest, kind), reused: Boolean(existing) };
}

export async function reuseOrCreateRelease(api, tag, tagTarget) {
  const existing = await api.releaseByTag(tag);
  if (existing) {
    verifyReleaseState(
      {
        tagName: tag,
        tagTarget,
        releaseTagName: existing.tagName,
        releaseTarget: existing.targetCommitish,
      },
      tag,
      tagTarget,
    );
    return 'reused';
  }
  await api.createRelease(tag);
  return 'created';
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitTags() {
  return git('tag', '--list', 'v*', '--sort=-version:refname').split('\n').filter(Boolean);
}

function tagMetadata(tag) {
  try {
    return {
      packageText: git('show', `${tag}:package.json`),
      changelog: git('show', `${tag}:CHANGELOG.md`),
    };
  } catch {
    return null;
  }
}

function tagTarget(tag, gitCommand = git) {
  try {
    return gitCommand('rev-list', '-n1', tag);
  } catch {
    return null;
  }
}

export async function publishRelease({
  api,
  version,
  pr,
  date,
  gitCommand = git,
  readFile = readFileSync,
  updateMetadata = updateRepositoryMetadata,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !Number.isSafeInteger(pr) || pr < 1)
    throw new Error('Missing release version or PR number');
  const tag = `v${version}`;
  const target = tagTarget(tag, gitCommand);
  if (target) return reuseOrCreateRelease(api, tag, target);
  if (
    !hasReleaseMetadata(
      readFile('package.json', 'utf8'),
      readFile('CHANGELOG.md', 'utf8'),
      version,
      date,
      pr,
    )
  )
    updateMetadata(version, date, pr);
  gitCommand('config', 'user.name', 'github-actions[bot]');
  gitCommand('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  gitCommand('add', 'package.json', 'CHANGELOG.md');
  try {
    gitCommand('diff', '--cached', '--quiet');
  } catch {
    gitCommand('commit', '-m', `chore(release): ${tag}`);
  }
  gitCommand('tag', tag);
  gitCommand('push', 'origin', 'main', tag);
  await api.createRelease(tag);
  return 'published';
}

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
      readTagMetadata: tagMetadata,
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

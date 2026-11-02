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

/** Creates the GitHub API boundary used by release calculation and publishing. */
export function createGitHubApi({
  token,
  repository,
  fetchImpl = fetch,
  apiUrl = 'https://api.github.com',
}) {
  if (!token) throw new Error('GITHUB_TOKEN is required for release API calls');
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

  const request = createApiRequest(apiUrl.replace(/\/$/, ''), token, fetchImpl);
  return {
    closingIssueTitles: createClosingIssueTitles(request, owner, repo),
    issueTitle: createIssueTitle(request, owner, repo),
    releaseByTag: createReleaseByTag(request, owner, repo),
    createRelease: createRelease(request, owner, repo),
  };
}

function createApiRequest(base, token, fetchImpl) {
  return async function request(path, { method = 'GET', body, missingIsNull = false } = {}) {
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

    if (isMissingResponse(response, missingIsNull)) return null;
    validateApiResponse(response, method, path);
    const value = await response.json();
    throwGraphQlError(value);
    return value;
  };
}

function createClosingIssueTitles(request, owner, repo) {
  return async function closingIssueTitles(number) {
    const titles = [];
    let after = null;

    do {
      const result = await request('/graphql', {
        method: 'POST',
        body: { query: closingIssuesQuery, variables: { owner, repo, number, after } },
      });
      const connection = closingIssueConnection(result);
      titles.push(...(connection.nodes ?? []).map((issue) => issue?.title).filter(Boolean));
      after = nextClosingIssueCursor(connection.pageInfo);
    } while (after);

    return titles;
  };
}

function createIssueTitle(request, owner, repo) {
  return async function issueTitle(number) {
    const issue = await request(`/repos/${owner}/${repo}/issues/${number}`, {
      missingIsNull: true,
    });
    return issue?.title ?? null;
  };
}

function createReleaseByTag(request, owner, repo) {
  return async function releaseByTag(tag) {
    const release = await request(
      `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      { missingIsNull: true },
    );
    return release
      ? { tagName: release.tag_name, targetCommitish: release.target_commitish }
      : null;
  };
}

function createRelease(request, owner, repo) {
  return async function createReleaseForTag(tag) {
    return request(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      body: { tag_name: tag, name: tag, generate_release_notes: true },
    });
  };
}

function isMissingResponse(response, missingIsNull) {
  return missingIsNull && response.status === 404;
}

function validateApiResponse(response, method, path) {
  if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed: HTTP ${response.status}`);
}

function throwGraphQlError(value) {
  if (value.errors?.length)
    throw new Error(`GitHub GraphQL query failed: ${value.errors[0].message}`);
}

function closingIssueConnection(result) {
  const connection = result.data?.repository?.pullRequest?.closingIssuesReferences;
  if (!connection) throw new Error('GitHub returned no closing-issues list');
  return connection;
}

function nextClosingIssueCursor(pageInfo) {
  if (!pageInfo?.hasNextPage) return null;
  if (!pageInfo.endCursor) throw new Error('GitHub returned closing-issues page without a cursor');
  return pageInfo.endCursor;
}

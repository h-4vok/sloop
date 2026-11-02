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
          throw new Error('GitHub returned closing-issues page without a cursor');
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
        { missingIsNull: true },
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

/** Extracts distinct issue numbers explicitly closed by a pull request body. */
export function closingIssueNumbers(body) {
  return [
    ...new Set([...body.matchAll(/\bcloses?\s+#(\d+)\b/gi)].map((match) => Number(match[1]))),
  ];
}

/** Resolves issue titles from GitHub links, with pull request text as a fallback. */
export async function resolveIssueTitles(api, number, body, warn = console.warn) {
  const linkedTitles = await resolveLinkedIssueTitles(api, number, warn);
  if (linkedTitles.length) return linkedTitles;
  return resolveBodyIssueTitles(api, body, warn);
}

async function resolveLinkedIssueTitles(api, number, warn) {
  try {
    return await api.closingIssueTitles(number);
  } catch (error) {
    warn(`Closing-issue lookup failed; trying PR body: ${error.message}`);
    return [];
  }
}

async function resolveBodyIssueTitles(api, body, warn) {
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

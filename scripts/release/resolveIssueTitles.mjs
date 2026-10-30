/** Extracts distinct issue numbers explicitly closed by a pull request body. */
export function closingIssueNumbers(body) {
  return [
    ...new Set([...body.matchAll(/\bcloses?\s+#(\d+)\b/gi)].map((match) => Number(match[1]))),
  ];
}

/** Resolves issue titles from GitHub links, with pull request text as a fallback. */
export async function resolveIssueTitles(api, number, body, warn = console.warn) {
  try {
    const linkedTitles = await api.closingIssueTitles(number);
    if (linkedTitles.length) return linkedTitles;
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

export type SelectableIssue = {
  number: number;
  labels?: readonly (string | { name?: string })[];
};

export function issueLabelNames(
  labels: readonly (string | { name?: string })[] | undefined,
): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((label): label is string => Boolean(label));
}

/** Return issues in configured priority order, then ascending issue number. */
export function selectIssues<T extends SelectableIssue>(
  issues: readonly T[],
  priorityLabels: readonly string[],
): T[] {
  const priorities = new Map(priorityLabels.map((label, index) => [label, index]));
  const priorityOf = (issue: SelectableIssue): number => {
    const matches = issueLabelNames(issue.labels)
      .map((label) => priorities.get(label))
      .filter((priority): priority is number => priority !== undefined);
    return matches.length ? Math.min(...matches) : priorityLabels.length;
  };
  return [...issues].sort((a, b) => priorityOf(a) - priorityOf(b) || a.number - b.number);
}

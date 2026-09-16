export function issueLabelNames(
  labels: readonly (string | { name?: string })[] | undefined,
): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((label): label is string => Boolean(label));
}

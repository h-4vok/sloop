const secret = /(authorization|token|password|secret|api[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/gi;
export function allowlistedPublication(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(secret, '$1=<redacted>');
  if (Array.isArray(value)) return value.map(allowlistedPublication);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(stdout|stderr|raw|payload|environment)$/i.test(key)) continue;
      out[key] = /^(authorization|token|password|secret|api[_-]?key|cookie)$/i.test(key)
        ? '<redacted>'
        : allowlistedPublication(item);
    }
    return out;
  }
  return value;
}

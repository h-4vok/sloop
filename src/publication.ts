const secretKey =
  /(?:authorization|[a-z0-9_-]*(?:token|password|secret|cookie|credential)s?|api[_-]?key)/i;
const secret = new RegExp(
  String.raw`((?:["']?${secretKey.source}["']?)\s*[:=]\s*)(?:bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)`,
  'gi',
);
const urlSecret = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/gi;

/** Sanitize one remote GitHub publication body at the final adapter boundary. */
export function publicationBody(value: unknown): string {
  const safe = allowlistedPublication(value);
  if (typeof safe !== 'string') throw new TypeError('GitHub publication body must be a string');
  return safe;
}

export function allowlistedPublication(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(urlSecret, '$1<redacted>@').replace(secret, '$1<redacted>');
  if (Array.isArray(value)) return value.map(allowlistedPublication);
  if (!isPublicationRecord(value)) return value;
  return sanitizePublicationRecord(value);
}

function sanitizePublicationRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPrivatePublicationField(key)) continue;
    sanitized[key] = sanitizePublicationField(key, item);
  }
  return sanitized;
}

function isPrivatePublicationField(key: string): boolean {
  return /^(stdout|stderr|raw|payload|environment)$/i.test(key);
}

function sanitizePublicationField(key: string, value: unknown): unknown {
  return secretKey.test(key) ? '<redacted>' : allowlistedPublication(value);
}

function isPublicationRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

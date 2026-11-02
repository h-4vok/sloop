import type { ConfigDiagnostic } from './types.js';

const credentialValueOptions =
  /^(?:-(?:u|b|H)|--(?:header|[a-z0-9-]*(?:api-?key|token|secret|credential|password|passwd|cookie)|user|proxy-user|oauth2-bearer)|http\.extraheader)$/i;

function credentialStringDiagnostics(value: string, path: string): ConfigDiagnostic[] {
  const hasUrlUserinfo = /^[a-z][a-z\d+.-]*:\/\/[^\s/@]+(?::[^\s/@]*)?@/i.test(value);
  const hasRecognizedToken =
    /(?:^|[^A-Za-z0-9])(?:github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{10,})(?:$|[^A-Za-z0-9])/i.test(
      value,
    );
  const credentialPatterns = [
    /(?:^|[=\s])(?:authorization|proxy-authorization|cookie|set-cookie|[a-z0-9-]*(?:token|key|secret))\s*:\s*\S+/i,
    /(?:^|[\s,;])(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[=:]\s*\S+/i,
    /(?:^|[\s,;])[a-z0-9_.-]*(?:token|key|secret|password|passwd|cookie)\s*=\s*\S+/i,
    /[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|password|passwd)=[^&#\s]+/i,
    /^(?:--(?:[a-z0-9-]*(?:api-?key|token|secret|credential|password|passwd|cookie)|user|proxy-user|oauth2-bearer)|http\.extraheader)=\S+/i,
    /^-(?:u|b)\S+/i,
    /^-H(?:authorization|proxy-authorization|cookie|set-cookie|[a-z0-9-]*(?:token|key|secret))\s*:\s*\S+/i,
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
  ];
  const hasCredentialMaterial = credentialPatterns.some((pattern) => pattern.test(value));
  if (!hasUrlUserinfo && !hasRecognizedToken && !hasCredentialMaterial) return [];

  return [
    {
      path,

      message: 'credentials are not accepted in sloop.config.yaml; use the external environment',
    },
  ];
}

function credentialArrayDiagnostics(
  values: readonly unknown[],
  path: string,
  ancestors: WeakSet<object>,
): ConfigDiagnostic[] {
  return values.flatMap((child, index) =>
    credentialArrayChildDiagnostics(values, child, index, path, ancestors),
  );
}

function credentialArrayChildDiagnostics(
  values: readonly unknown[],
  child: unknown,
  index: number,
  path: string,
  ancestors: WeakSet<object>,
): ConfigDiagnostic[] {
  if (isCredentialOptionValue(values, child, index))
    return [credentialDiagnostic(`${path}[${index}]`)];
  return credentialDiagnostics(child, `${path}[${index}]`, ancestors);
}

function isCredentialOptionValue(
  values: readonly unknown[],
  child: unknown,
  index: number,
): boolean {
  const previousValue = values[index - 1];
  return (
    index > 0 &&
    typeof previousValue === 'string' &&
    credentialValueOptions.test(previousValue) &&
    typeof child === 'string' &&
    child.length > 0
  );
}

function credentialDiagnostic(path: string): ConfigDiagnostic {
  return {
    path,
    message: 'credentials are not accepted in sloop.config.yaml; use the external environment',
  };
}

function credentialDiagnostics(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): ConfigDiagnostic[] {
  if (typeof value === 'string') return credentialStringDiagnostics(value, path);
  if (value === null || typeof value !== 'object') return [];
  if (ancestors.has(value)) return [{ path, message: 'YAML aliases must not form cycles' }];
  ancestors.add(value);
  return containerCredentialDiagnostics(value, path, ancestors);
}

function containerCredentialDiagnostics(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
): ConfigDiagnostic[] {
  if (Array.isArray(value)) return credentialArrayDiagnostics(value, path, ancestors);
  return Object.entries(value).flatMap(([key, child]) =>
    credentialDiagnostics(child, `${path}.${key}`, ancestors),
  );
}

/** Finds credential-like values before configuration secrets can enter tracked YAML. */
export const findCredentialDiagnostics = (value: unknown): ConfigDiagnostic[] =>
  credentialDiagnostics(value, '$', new WeakSet<object>());

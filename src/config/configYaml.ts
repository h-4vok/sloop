import { Document, isAlias, parseDocument, visit, type Node } from 'yaml';
import { ConfigValidationError, type SloopConfig } from './types.js';
import { configRegistry, getConfigField } from './configRegistry.js';
import { configValidator } from './parseConfig.js';
import type { Result } from './Result.js';

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1))
    current = (current[part] ??= {}) as Record<string, unknown>;
  current[parts.at(-1)!] = value;
}
function loadConfigTextResult(
  source: string,
  onUnknownKey?: (path: string) => void,
): Result<SloopConfig, ConfigValidationError> {
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length)
    return {
      ok: false,
      error: new ConfigValidationError(
        document.errors.map((error) => ({ path: '$', message: `invalid YAML: ${error.message}` })),
      ),
    };
  let aliasFound = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) aliasFound = true;
  });
  if (aliasFound)
    return {
      ok: false,
      error: new ConfigValidationError([
        { path: '$', message: 'YAML aliases are not supported in sloop.config.yaml' },
      ]),
    };

  return configValidator.parseConfigResult(document.toJS(), onUnknownKey);
}

function updateConfigTextResult(
  source: string,
  path: string,
  value: unknown,
  onUnknownKey?: (path: string) => void,
): Result<string, ConfigValidationError> {
  const metadata = getConfigField(path);
  if (!metadata)
    return {
      ok: false,
      error: new ConfigValidationError([
        { path: `$.${path}`, message: 'unknown configuration key' },
      ]),
    };
  const parsedValue = metadata.parser(value, `$.${path}`);
  if (!parsedValue.ok) return parsedValue;

  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length)
    return {
      ok: false,
      error: new ConfigValidationError(
        document.errors.map((error) => ({ path: '$', message: `invalid YAML: ${error.message}` })),
      ),
    };
  document.setIn(path.split('.'), value as Node);
  const validationResult = configValidator.parseConfigResult(document.toJS(), onUnknownKey);
  if (!validationResult.ok) return validationResult;

  return { ok: true, value: document.toString({ lineWidth: 0 }) };
}

function canonicalConfigYaml(): string {
  const document = new Document();
  const value: Record<string, unknown> = {};
  for (const metadata of configRegistry)
    setPath(
      value,
      metadata.path,
      metadata.type === 'duration' ? formatDuration(metadata.default as number) : metadata.default,
    );
  document.contents = document.createNode(value);
  for (const metadata of configRegistry) {
    const node = document.getIn(metadata.path.split('.'), true);
    if (node && typeof node === 'object') (node as Node).commentBefore = ` ${metadata.explanation}`;
  }
  return document
    .toString({ lineWidth: 0 })
    .replace(
      /^(\s*(?:-\s+)?)"([^"\n]*)"$/gm,
      (_match, prefix, value) => `${prefix}'${value.replaceAll("'", "''")}'`,
    );
}
function formatDuration(milliseconds: number): string {
  for (const [unit, amount] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ] as const)
    if (milliseconds % amount === 0) return `${milliseconds / amount}${unit}`;
  return `${milliseconds}ms`;
}
/** Groups YAML document operations that preserve the editable configuration format. */
export const configYaml = Object.freeze({
  loadConfigTextResult,
  updateConfigTextResult,
  canonicalConfigYaml,
});

import type { Result } from '../Result.js';
import { ConfigValidationError } from '../types.js';

export type ParserResult<T> = Result<T, ConfigValidationError>;

export const invalid = (path: string, message: string): ParserResult<never> => ({
  ok: false,

  error: new ConfigValidationError([{ path, message }]),
});

export const valid = <T>(value: T): ParserResult<T> => ({ ok: true, value });

export const stringParser = (value: unknown, path: string): ParserResult<string> =>
  typeof value === 'string' && value.trim()
    ? valid(value)
    : invalid(path, 'expected a non-empty string');

export const booleanParser = (value: unknown, path: string): ParserResult<boolean> =>
  typeof value === 'boolean' ? valid(value) : invalid(path, 'expected a boolean');

export const integerParser = (value: unknown, path: string): ParserResult<number> =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? valid(value as number)
    : invalid(path, 'expected a non-negative integer');

export const enumParser =
  <T extends string>(choices: readonly T[]) =>
  (value: unknown, path: string): ParserResult<T> =>
    typeof value === 'string' && choices.includes(value as T)
      ? valid(value as T)
      : invalid(path, `expected one of: ${choices.join(', ')}`);

export const listParser = (value: unknown, path: string): ParserResult<readonly string[]> => {
  if (!Array.isArray(value)) return invalid(path, 'expected a list');
  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsedItem = stringParser(item, `${path}[${index}]`);
    if (!parsedItem.ok) return parsedItem;
    items.push(parsedItem.value);
  }
  return valid(items);
};

export const durationParser = (value: unknown, path: string): ParserResult<number> => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return valid(value);
  if (typeof value !== 'string') return invalid(path, 'expected a duration such as 5m');
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) return invalid(path, 'expected a duration such as 5m');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  const result = Number(match[1]) * multiplier;
  return Number.isSafeInteger(result) ? valid(result) : invalid(path, 'duration is too large');
};

export const pathParser = (value: unknown, path: string): ParserResult<string> => {
  const result = stringParser(value, path);
  if (!result.ok) return result;
  return result.value.includes('\0') ? invalid(path, 'path contains a NUL byte') : result;
};

export const unrestrictedStringParser = (value: unknown, path: string): ParserResult<string> =>
  typeof value === 'string' ? valid(value) : invalid(path, 'expected a string');

/** Exposes primitive configuration value parsers. */
export const configValueParsers = Object.freeze({
  stringParser,
  booleanParser,
  integerParser,
  enumParser,
  listParser,
  durationParser,
  pathParser,
  unrestrictedStringParser,
});

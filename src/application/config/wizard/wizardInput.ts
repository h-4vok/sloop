import type { Logger } from '../../../core/Logger.js';
import {
  ConfigValidationError,
  configValue,
  parseConfigValueResult,
  type FieldMetadata,
  type Result,
} from '../../../config.js';
import type { WizardSession } from './WizardSession.js';

/** Formats values in wizard prompts and change summaries. */
export function displayWizardValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Asks one config field while preserving the existing prompt text. */
export async function askWizardField(
  session: WizardSession,
  field: FieldMetadata,
  context?: string,
): Promise<string> {
  return session.readline.question(
    `\n${paint(field.path + (context ? ` (${context})` : ''), 'cyan', session.useColor)}\n  ${field.explanation}\n  ${paint('options:', 'dim', session.useColor)} ${field.choices.length ? field.choices.join(', ') : 'free value'}\n  ${paint('recommendation:', 'dim', session.useColor)} ${field.recommendation}\n  ${paint(`current value [${displayWizardValue(configValue(session.current as never, field.path))}]:`, 'yellow', session.useColor)} `,
  );
}

/** Parses user-facing list and argv answers through their public field parsers. */
export function parseWizardValueResult(
  field: FieldMetadata,
  raw: string,
): Result<unknown, ConfigValidationError> {
  if (field.type === 'list') return parseListValue(field, raw);
  if (field.type === 'argv') return parseArgumentVector(field, raw);
  return parseConfigValueResult(field, raw);
}

function parseListValue(field: FieldMetadata, raw: string): Result<unknown, ConfigValidationError> {
  return field.parser(
    raw.split(',').map((item) => item.trim()),
    `$.${field.path}`,
  );
}

function parseArgumentVector(
  field: FieldMetadata,
  raw: string,
): Result<unknown, ConfigValidationError> {
  let parsedArgv: unknown;
  try {
    parsedArgv = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {
      ok: false,
      error: new ConfigValidationError([
        { path: `$.${field.path}`, message: `expected valid JSON: ${error.message}` },
      ]),
    };
  }

  return field.parser(parsedArgv, `$.${field.path}`);
}

/** Writes expected wizard errors through the injected logger. */
export function failWizard(message: string, logger: Logger): number {
  logger.error(message);

  return 2;
}

function paint(
  text: string,
  color: 'cyan' | 'yellow' | 'green' | 'red' | 'dim',
  enabled: boolean,
): string {
  if (!enabled) return text;
  const codes = { cyan: 36, yellow: 33, green: 32, red: 31, dim: 2 } as const;

  return `\u001b[${codes[color]}m${text}\u001b[0m`;
}

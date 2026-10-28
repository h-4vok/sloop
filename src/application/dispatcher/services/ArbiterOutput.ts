import type { Spec } from '../../../application/dispatcher/types/index.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ArbiterSchema } from './ArbiterSchema.js';
const { writeArbiterSchema } = ArbiterSchema;

function withOption(args: readonly string[], name: string, value: string): string[] {
  const result = [...args];
  const index = result.indexOf(name);
  if (index === -1) return [...result, name, value];
  if (index + 1 === result.length) result.push(value);
  else result[index + 1] = value;

  return result;
}

function createStructuredArbiterOutput(
  spec: Spec,
): { spec: Spec; outputPath: string; directory: string } | undefined {
  if (!/^(?:.*[\\/])?codex(?:\.cmd|\.exe)?$/i.test(spec.command) || spec.args[0] !== 'exec')
    return undefined;

  const schemaRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'assets',
    'schemas',
  );
  const directory = mkdtempSync(join(tmpdir(), 'sloop-arbiter-'));
  const schemaPath = join(directory, 'schema.json');
  const outputPath = join(directory, 'output.json');

  try {
    writeArbiterSchema(schemaRoot, schemaPath);

    return {
      spec: {
        ...spec,

        args: withOption(
          withOption(spec.args, '--output-schema', schemaPath),
          '--output-last-message',
          outputPath,
        ),
      },

      outputPath,

      directory,
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Prepares temporary, strict JSON-schema output settings for the Arbiter CLI. */
export const ArbiterOutput = {
  withOption,

  createStructuredArbiterOutput,
};

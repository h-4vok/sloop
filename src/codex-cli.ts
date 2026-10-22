import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Launch the installed Codex CLI through Node instead of a Windows npm shim. */
export function codexCliInvocation(args: readonly string[]): Readonly<{
  command: string;
  args: string[];
}> {
  return {
    command: process.execPath,
    args: [require.resolve('@openai/codex/bin/codex.js'), ...args],
  };
}

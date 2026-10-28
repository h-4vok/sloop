/** Configured external command in argv-array or command-and-options form. */
export type Command =
  | string[]
  | { command: string; args: string[]; timeoutMs?: number; retries?: number; sessions?: boolean };

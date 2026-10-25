/** Stable process exit codes exposed by Sloop commands. */
export const EXIT = Object.freeze({ ok: 0, preflight: 2, busy: 3, blocked: 4, external: 5 });

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

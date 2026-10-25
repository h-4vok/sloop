import type { DispatcherCommand } from '../dispatcher/DispatcherCommand.js';
import type { ReadOnlyCommand } from './ReadOnlyCommand.js';

/** Parsed top-level command accepted by the Sloop CLI. */
export type CliCommand =
  | Readonly<{ kind: 'help'; target: string }>
  | Readonly<{ kind: 'version' }>
  | Readonly<{ kind: 'read-only'; command: ReadOnlyCommand }>
  | Readonly<{ kind: 'config'; args: readonly string[] }>
  | Readonly<{ kind: 'dispatcher'; command: DispatcherCommand }>;

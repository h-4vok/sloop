import type { DispatcherCommand } from '../../dispatcher/DispatcherCommand.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import { repositoryPreflight } from './RepositoryPreflight.js';

/** Validates the repository before running a workflow dispatcher command. */
export const runDispatcherPreflight = (command: DispatcherCommand, providedIo?: RuntimeIo) =>
  repositoryPreflight.runDispatcherPreflight(command, providedIo);

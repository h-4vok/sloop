import type { RuntimeIo } from '../RuntimeIo.js';
import type { Diagnostic } from '../RuntimeResult.js';
import type { Result } from '../../../core/Result.js';
import { discoverRepository as findRepository } from './preflight/loadRepositoryConfig.js';

/** Resolves the Git repository containing the current CLI working directory. */
export const discoverRepository = (io: RuntimeIo): Result<string, Diagnostic> => findRepository(io);

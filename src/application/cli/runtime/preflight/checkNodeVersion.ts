import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { createDiagnostic } from './checkSupport.js';

/** Checks platform and Node.js requirements for every dispatcher command. */
export const checkNodeVersion = Object.freeze({
  checkPlatform(io: RuntimeIo): Diagnostic[] {
    if (['win32', 'linux', 'darwin'].includes(io.platform)) return [];

    return [
      createDiagnostic(
        'platform',
        `Platform ${io.platform} is unsupported.`,
        'Run Sloop on Windows, Linux, or macOS.',
      ),
    ];
  },

  checkNodeVersion(io: RuntimeIo): Diagnostic[] {
    const major = Number(io.nodeVersion.replace(/^v/, '').split('.')[0]);
    if (Number.isInteger(major) && major >= 22) return [];

    return [
      createDiagnostic(
        'node',
        `Node.js ${io.nodeVersion} is unsupported.`,
        'Install Node.js 22 or newer.',
      ),
    ];
  },
});

import type { CliModules } from './CliModules.js';

export async function loadCliRuntime(
  modules: CliModules | undefined,
): Promise<NonNullable<CliModules['runtime']>> {
  return modules?.runtime ?? (await import('../../runtime.js'));
}

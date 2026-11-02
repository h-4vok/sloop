import { createIsolatedTemporaryDirectory } from '../../test/support/temporary-directory.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../src/dispatcher.js';
import { createArbiterDependencies } from './arbiter-dependencies.mjs';
import { createArbiterFixtures } from './arbiter-fixtures.mjs';

export async function runArbiterScenario(runCommand, registerCleanup) {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-real-arbiter-'));
  registerCleanup(root);
  writeFileSync(join(root, 'normalize.mjs'), 'export const normalize = (value) => value;\n');
  const { issue, pr, config, context } = createArbiterFixtures();
  const dependencies = createArbiterDependencies({ root, issue, pr, context, runCommand });
  await dispatch(config, dependencies);
  return { root, issue, pr, config, context };
}

import type { FieldMetadata } from './types.js';
import { agentsConfigFields } from './registry/agentsConfigFields.js';
import { executionConfigFields } from './registry/executionConfigFields.js';
import { githubConfigFields } from './registry/githubConfigFields.js';
import { repositoryConfigFields } from './registry/repositoryConfigFields.js';
import { workflowConfigFields } from './registry/workflowConfigFields.js';

/** Freezes the composed public configuration registry. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }

  return value;
}

/** Provides the authoritative schema and defaults for Sloop configuration. */
export const configRegistry = deepFreeze([
  ...repositoryConfigFields,
  ...githubConfigFields,
  ...workflowConfigFields,
  ...agentsConfigFields,
  ...executionConfigFields,
] satisfies readonly FieldMetadata[]);

/** Finds schema metadata for one configuration path. */
export function getConfigField(path: string): FieldMetadata | undefined {
  return configRegistry.find((item) => item.path === path);
}

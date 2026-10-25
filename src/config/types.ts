import type { ConfigReconcilerKind } from '../core/config/ConfigReconcilerKind.js';

/** Identifies the parser behavior and display format for one config field. */
export type ConfigValueType =
  'string' | 'boolean' | 'integer' | 'duration' | 'enum' | 'list' | 'path' | 'argv';
/** Controls whether a field may appear in configuration fingerprints. */
export type Sensitivity = 'public' | 'sensitive';
export type Reconciler = ConfigReconcilerKind;
/** Describes one configuration validation failure at its source path. */
export type ConfigDiagnostic = Readonly<{ path: string; message: string }>;

/** Carries structured validation failures across the existing config API. */
export class ConfigValidationError extends Error {
  constructor(readonly diagnostics: readonly ConfigDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path}: ${item.message}`).join('\n'));
    this.name = 'ConfigValidationError';
  }
}

/** Defines the schema, parser, default, and reconciliation policy for one field. */
export type FieldMetadata<T = unknown> = Readonly<{
  path: string;
  type: ConfigValueType;
  parser: (value: unknown, path: string) => T;
  validation: string;
  explanation: string;
  choices: readonly unknown[];
  recommendation: string;
  dependencies: readonly string[];
  default: T;
  sensitivity: Sensitivity;
  requiredReconciler: Reconciler;
}>;

/** Settings shared by each configured agent runner. */
export type RunnerConfig = Readonly<{
  harness: 'codex';
  model: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  timeout: number;
  retries: number;
}>;
/** Fully validated immutable configuration used by the Sloop runtime. */
export type SloopConfig = Readonly<{
  schemaVersion: 1;
  repository: Readonly<{ remote: string; baseBranch: string; branchPrefix: string }>;
  workspace: Readonly<{ mode: 'checkout' | 'worktree'; path: string; worktreeRoot: string }>;
  github: Readonly<{
    labels: Readonly<{
      eligible: string;
      claimed: string;
      blocked: string;
      priority: readonly string[];
    }>;
    roleMarkers: Readonly<{ worker: string; qa: string }>;
  }>;
  workflow: Readonly<{
    humanMergeWait: boolean;
    reviewOrder: readonly ['qa'];
  }>;
  agents: Readonly<{ worker: RunnerConfig; qa: RunnerConfig; arbiter: RunnerConfig }>;
  skills: Readonly<{ scope: 'repository' | 'user'; required: readonly string[] }>;
  health: Readonly<{ enabled: boolean; command: readonly string[]; timeout: number }>;
  loop: Readonly<{ interval: number; taskName: string }>;
  schedule: Readonly<{ enabled: boolean; expression: string }>;
  logging: Readonly<{ directory: string; retention: number; roleInvocation: boolean }>;
  arbiter: Readonly<{ reviewRounds: number; stagnatingAppearances: number; decisions: number }>;
}>;

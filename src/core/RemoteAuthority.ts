import type { RemoteSnapshot, RunManifest } from '../remote-state.js';

/** Remote source of truth for durable dispatcher run state. */
export interface RemoteAuthority {
  snapshot(issue: number): RemoteSnapshot;

  reconcile(issue: number, key: string): boolean;

  /** Publish a durable claim with its manifest. */
  claim(issue: number, key: string, manifest: RunManifest): void;

  /** Append a manifest version to the same deterministic artifact. */
  publish(issue: number, manifest: RunManifest): void;
}

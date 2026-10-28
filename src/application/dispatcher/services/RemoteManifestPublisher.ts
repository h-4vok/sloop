/** Coordinates remote manifest publisher operations for dispatcher workflows. */
import type { Config, Deps } from '../../../application/dispatcher/types/index.js';
import type { RunManifest } from '../../../remote-state.js';
import { artifactKey } from '../../../remote-state.js';
import { RemoteRunState } from './RemoteRunState.js';
const { remoteManifest, remoteOwner, remoteProjection } = RemoteRunState;

function publishRemoteManifest(
  cfg: Config,
  d: Deps,
  issue: number,
  phase: RunManifest['phase'],
  previous: RunManifest,
): void {
  if (!d.remote) return;
  const key = previous.artifacts[0] ?? artifactKey('run', { issue, runId: previous.runId });
  const manifest = remoteManifest(
    cfg,
    d,
    issue,
    previous.runId,
    key,
    phase,
    ['claimed', 'working', 'review'].includes(phase) ? remoteOwner(d, issue) : undefined,
    previous,
  );
  try {
    d.remote.publish(issue, manifest);
  } catch (error) {
    if (!d.remote.reconcile(issue, key)) throw error;
  }
}

function publishCurrentRemoteManifest(
  cfg: Config,
  d: Deps,
  issue: number,
  phase: RunManifest['phase'],
): void {
  const current = remoteProjection(d, issue)?.projection.manifest;
  if (current) publishRemoteManifest(cfg, d, issue, phase, current);
}

export const RemoteManifestPublisher = {
  publishRemoteManifest,

  publishCurrentRemoteManifest,
};

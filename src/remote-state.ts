import { projectRemoteState as projectResult } from './remote-state/projectRemoteState.js';
export { REMOTE_PROTOCOL } from './remote-state/RemoteManifest.js';
export type {
  RemoteSnapshot,
  RunManifest,
  WorkflowProjection,
} from './remote-state/RemoteManifest.js';
export {
  artifactKey,
  decodeRunManifestMarker,
  leaseIsActive,
  leaseIsActiveResult,
  parseRunManifestMarker,
  reconcileArtifact,
  runManifestMarker,
} from './remote-state/runManifestMarker.js';
export { validateRunManifest } from './remote-state/validateRunManifest.js';
export { projectRemoteState as projectRemoteStateResult } from './remote-state/projectRemoteState.js';
import type { RemoteSnapshot, WorkflowProjection } from './remote-state/RemoteManifest.js';

/** Keep existing callers on the established exception boundary. */
export function projectRemoteState(snapshot: RemoteSnapshot): WorkflowProjection {
  const projected = projectResult(snapshot);
  if (!projected.ok) throw projected.error;
  return projected.value;
}

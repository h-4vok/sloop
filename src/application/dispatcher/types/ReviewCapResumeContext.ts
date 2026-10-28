import type { RemoteSnapshot, RunManifest } from '../../../remote-state.js';
import type { State } from './State.js';

/** Locally validated state and remote evidence for a review-cap resume. */
export type ReviewCapResumeContext = {
  current: State;
  remoteSnapshot?: RemoteSnapshot;
  remoteManifest?: RunManifest;
};

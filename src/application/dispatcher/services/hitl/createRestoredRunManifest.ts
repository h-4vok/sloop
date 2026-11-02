import type { Config, Deps } from '../../types/index.js';
import type { RunManifest } from '../../../../remote-state.js';
import { artifactKey } from '../../../../remote-state.js';
import type { HitlResumeDirective } from '../../types/HitlResumeDirective.js';
import { RemoteRunState } from '../recovery/RemoteRunState.js';

const { remoteManifest } = RemoteRunState;

export function createRestoredRunManifest(
  cfg: Config,
  d: Deps,
  current: ReturnType<Deps['load']>,
  issue: number,
  branch: string,
  directive: HitlResumeDirective,
  previous: RunManifest,
): RunManifest {
  const key = previous.artifacts[0] ?? artifactKey('run', { issue, runId: previous.runId });

  return remoteManifest(cfg, d, issue, previous.runId, key, 'blocked', undefined, {
    ...previous,
    pr: current.pr,
    branch,
    reviewRound: directive.round,
  });
}

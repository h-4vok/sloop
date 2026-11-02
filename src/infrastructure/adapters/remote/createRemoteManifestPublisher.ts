import { artifactKey, runManifestMarker } from '../../../remote-state.js';
import type { RunManifest } from '../../../remote-state.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';
type Client = ReturnType<typeof gitHubCommandClientFactory.create>;

/** Publishes deterministic manifest markers as issue comments. */
export function createRemoteManifestPublisher(client: Client) {
  return (issue: number, manifest: RunManifest): void => {
    const key = manifest.artifacts[0] ?? artifactKey('run', { issue, runId: manifest.runId });
    const body = `${runManifestMarker(manifest)}\nsloop/v1/run/${manifest.runId}\n${key}`;
    client.run(['issue', 'comment', String(issue), '--body', body], { stdio: 'inherit' });
  };
}

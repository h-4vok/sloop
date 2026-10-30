import { runManifestMarker } from '../../../remote-state.js';
import type { RunManifest } from '../../../remote-state.js';
import type { gitHubCommandClientFactory } from '../createGitHubCommandClient.js';
type Client = ReturnType<typeof gitHubCommandClientFactory.create>;

/** Stores remote claim leases and checks whether publication already landed. */
export function createRemoteClaimStore(client: Client) {
  return {
    reconcile(issue: number, key: string): boolean {
      const result = client.runJson<{ comments?: readonly { body: string }[] }>([
        'issue',
        'view',
        String(issue),
        '--json',
        'comments',
      ]);
      return result.comments?.some(({ body }) => body.includes(key)) ?? false;
    },
    claim(issue: number, key: string, manifest: RunManifest | string): void {
      const body = createClaimBody(issue, key, manifest);
      client.run(['issue', 'comment', String(issue), '--body', body], { stdio: 'inherit' });
    },
  };
}

function createClaimBody(issue: number, key: string, manifest: RunManifest | string): string {
  if (typeof manifest === 'string') return `sloop/v1/lease/${issue}/${key}/${manifest}`;

  const manifestWithClaim = runManifestMarker({
    ...manifest,
    artifacts: [...new Set([...(manifest.artifacts ?? []), key])],
  });
  return `${manifestWithClaim}\nsloop/v1/run/${manifest.runId}\n${key}\nsloop/v1/lease/${issue}/${manifest.lease?.owner ?? key}/${manifest.lease?.expiresAt ?? ''}`;
}

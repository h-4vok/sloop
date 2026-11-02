import type { RemoteAuthority } from '../../core/RemoteAuthority.js';
import { ExternalServiceError } from '../../core/ExternalServiceError.js';
import { artifactKey } from '../../remote-state.js';
import type { RunManifest } from '../../remote-state.js';
import type { gitHubCommandClientFactory } from './createGitHubCommandClient.js';
import { createRemoteClaimStore } from './remote/createRemoteClaimStore.js';
import { createRemoteManifestPublisher } from './remote/createRemoteManifestPublisher.js';
import { createRemoteSnapshotReader } from './remote/createRemoteSnapshotReader.js';
type Client = ReturnType<typeof gitHubCommandClientFactory.create>;
type Logger = (phase: string, operation: string, data: unknown) => void;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function createRemoteHandler<T extends (...args: any[]) => any>(
  operation: string,
  logger: Logger,
  action: T,
  request: (args: Parameters<T>) => unknown,
  response: (result: ReturnType<T>, args: Parameters<T>) => unknown = (result) => result,
  failure: 'snapshot' | 'reconciliation' | undefined = undefined,
): T {
  return ((...args: Parameters<T>) => {
    try {
      logger('request', operation, request(args));
      const result = action(...args);
      logger('response', operation, response(result, args));
      return result;
    } catch (error) {
      logger('error', operation, messageOf(error));
      if (!failure) throw error;
      throw new ExternalServiceError(
        'github',
        `GitHub ${failure} unavailable: ${messageOf(error)}`,
      );
    }
  }) as T;
}

/** Composes snapshot, claim, reconciliation, and publication remote ports. */
export const remoteAuthorityFactory = Object.freeze({
  create(client: Client, repository: string, logGithub: Logger): RemoteAuthority {
    const snapshots = createRemoteSnapshotReader(client, repository);
    const claims = createRemoteClaimStore(client);
    const publish = createRemoteManifestPublisher(client);
    return {
      snapshot: createRemoteHandler(
        'remote.snapshot',
        logGithub,
        snapshots,
        ([issue]) => ({ issue }),
        undefined,
        'snapshot',
      ),
      reconcile: createRemoteHandler(
        'remote.reconcile',
        logGithub,
        claims.reconcile,
        ([issue, key]) => ({ issue, key }),
        (found, [issue, key]) => ({ issue, key, found }),
        'reconciliation',
      ),
      claim: createRemoteHandler(
        'remote.claim',
        logGithub,
        (issue: number, key: string, manifest: RunManifest | string) =>
          claims.claim(issue, key, manifest),
        ([issue, key, manifest]) => ({ issue, key, manifest }),
        (_result, [issue, key]) => ({ issue, key }),
      ),
      publish: createRemoteHandler(
        'remote.publish',
        logGithub,
        publish,
        ([issue, manifest]) => ({ issue, key: remoteArtifactKey(issue, manifest), manifest }),
        (_result, [issue, manifest]) => ({ issue, key: remoteArtifactKey(issue, manifest) }),
      ),
    };
  },
});

function remoteArtifactKey(issue: number, manifest: RunManifest): string {
  return manifest.artifacts[0] ?? artifactKey('run', { issue, runId: manifest.runId });
}

import type { Diagnostic } from '../../RuntimeResult.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { createDiagnostic } from './checkSupport.js';

/** Holds repository identity parsed from a GitHub remote. */
export type GitHubIdentity = Readonly<{ repository?: string; failures: Diagnostic[] }>;

/** Reads and validates the GitHub repository identity and caller permissions. */
export const checkGitHubIdentity = Object.freeze({
  readGitHubIdentity(
    remoteUrl: string,
    root: string,
    io: RuntimeIo,
    allLabels: boolean,
  ): GitHubIdentity {
    const failures: Diagnostic[] = [];
    const identity = io.run(
      'gh',
      ['repo', 'view', remoteUrl, '--json', 'nameWithOwner,viewerPermission'],
      root,
    );
    if (identity.status !== 0)
      failures.push(
        createDiagnostic(
          'repository-identity',
          'The configured Git remote does not resolve to an accessible GitHub repository.',
          'Correct the configured remote or request repository access.',
        ),
      );
    else failures.push(...this.validateGitHubPermissions(identity.stdout, allLabels));

    const repositoryResult = this.githubRepository(remoteUrl);
    if (!repositoryResult.ok)
      failures.push(
        createDiagnostic(
          'repository-identity',
          'The configured remote is not a GitHub repository URL.',
          'Set the configured remote to the target GitHub repository URL.',
        ),
      );

    return { repository: repositoryResult.ok ? repositoryResult.value : undefined, failures };
  },

  validateGitHubPermissions(response: string, allLabels: boolean): Diagnostic[] {
    const repository = this.parseGitHubRepository(response);
    if (!repository)
      return [
        createDiagnostic(
          'repository-identity',
          'GitHub returned invalid repository identity data.',
          'Retry the command.',
        ),
      ];

    return [
      ...this.validateGitHubIdentity(repository.nameWithOwner),
      ...this.validateGitHubPermission(repository.viewerPermission, allLabels),
    ];
  },

  parseGitHubRepository(
    response: string,
  ): { nameWithOwner?: string; viewerPermission?: string } | undefined {
    try {
      const repository: unknown = JSON.parse(response);
      if (!repository || typeof repository !== 'object' || Array.isArray(repository))
        return undefined;

      return repository as { nameWithOwner?: string; viewerPermission?: string };
    } catch {
      return undefined;
    }
  },

  validateGitHubIdentity(nameWithOwner?: string): Diagnostic[] {
    if (nameWithOwner) return [];

    return [
      createDiagnostic(
        'repository-identity',
        'GitHub returned no repository identity.',
        'Correct the configured remote.',
      ),
    ];
  },

  validateGitHubPermission(viewerPermission: string | undefined, allLabels: boolean): Diagnostic[] {
    if (hasRequiredPermission(viewerPermission, allLabels)) return [];

    return [createPermissionDiagnostic(allLabels)];
  },

  githubRepository(
    remoteUrl: string,
  ): Readonly<{ ok: true; value: string }> | Readonly<{ ok: false; error: string }> {
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (!match) return { ok: false, error: 'configured remote is not a GitHub repository URL' };

    return { ok: true, value: `${match[1]}/${match[2]}` };
  },
});

function hasRequiredPermission(viewerPermission: string | undefined, allLabels: boolean): boolean {
  const acceptedPermissions = allLabels
    ? ['WRITE', 'MAINTAIN', 'ADMIN']
    : ['READ', 'TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'];
  return acceptedPermissions.includes(viewerPermission ?? '');
}

function createPermissionDiagnostic(allLabels: boolean): Diagnostic {
  const access = allLabels ? 'write' : 'read';
  return createDiagnostic(
    'permissions',
    `Repository ${access} permission is unavailable.`,
    `Request repository ${access} access.`,
  );
}

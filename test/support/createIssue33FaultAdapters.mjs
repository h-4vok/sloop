import { createFaultWorkspaceAdapter } from './issue33FaultWorkspaceAdapter.mjs';
import { createFaultRemoteAdapter } from './issue33FaultRemoteAdapter.mjs';

export function createIssue33FaultAdapters(fixture, options) {
  return {
    workspaceAdapter: createFaultWorkspace(fixture),
    remote: createFaultRemote(fixture, options),
  };
}

function createFaultWorkspace(fixture) {
  return createFaultWorkspaceAdapter({
    root: fixture.root,
    readState: () => fixture.state,
    readRemote: () => fixture.remote,
    onPrepare: () => {
      fixture.prepareCount += 1;
    },
  });
}

function createFaultRemote(fixture, options) {
  return createFaultRemoteAdapter({
    snapshot: () => createFaultSnapshot(fixture, options.outage),
    readRemote: () => fixture.remote,
    writeRemote: (value) => {
      fixture.remote = value;
    },
    recordClaim: () => {
      fixture.claimCount += 1;
    },
    recordPublication: (manifest) => recordFaultPublication(fixture, manifest),
    isAmbiguous: () => options.ambiguous ?? false,
  });
}

function createFaultSnapshot(fixture, outage) {
  if (outage) throw new Error('GitHub outage');
  const remote = fixture.remote;
  return {
    issue: 33,
    markers: remote ? [`sloop/v1/run/${remote.runId}`, ...remote.artifacts] : [],
    manifest: remote,
    branch: remote?.branch,
    sha: remote?.baseSha,
    now: Date.now(),
    leaseOwner: '7001:33',
  };
}

function recordFaultPublication(fixture, manifest) {
  fixture.publishCount += 1;
  fixture.publishedManifests.push(manifest);
}

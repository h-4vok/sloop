export const createFaultWorkspaceAdapter = ({ root, readState, readRemote, onPrepare }) => ({
  prepare: () => {
    onPrepare();
    return {
      workspaceRoot: root,
      executionRoot: root,
      branch: 'codex/issue-33-fault',
      baseSha: 'abcdef1',
      headSha: 'abcdef1',
      ownership: {
        runId: readState().workerRunId ?? 'fault-run',
        issue: 33,
        protocol: 'sloop-workspace-v1',
      },
    };
  },
  recover: (_issue, runId, branch) => {
    const remote = readRemote();
    return remote && branch && branch !== 'pending'
      ? {
          workspaceRoot: root,
          executionRoot: root,
          branch,
          baseSha: 'abcdef1',
          headSha: 'abcdef1',
          ownership: { runId, issue: 33, protocol: 'sloop-workspace-v1' },
        }
      : undefined;
  },
  cleanup: () => {},
});

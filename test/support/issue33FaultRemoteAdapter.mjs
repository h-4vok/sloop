export const createFaultRemoteAdapter = ({
  snapshot,
  readRemote,
  writeRemote,
  recordClaim,
  recordPublication,
  isAmbiguous,
}) => ({
  snapshot,

  reconcile: (_issue, key) => Boolean(readRemote()?.artifacts.includes(key)),

  claim: (_issue, key, manifest) => {
    recordClaim();
    writeRemote({ ...manifest, artifacts: [key] });

    if (isAmbiguous()) throw new Error('ambiguous remote response');
  },

  publish: (_issue, manifest) => {
    recordPublication(manifest);
    writeRemote(manifest);
  },
});

export const createFaultLeaseDependencies = () => ({
  now: () => Date.now(),

  pid: () => 7001,

  processAlive: () => true,

  sleep: async () => {},

  onReclaim: () => {},

  tryAcquire: () => true,

  readOwner: () => {
    throw new Error('unused');
  },

  tryBeginReclaim: () => true,

  readReclaimOwner: () => {
    throw new Error('unused');
  },

  reclaimAgeMs: () => 0,

  finishReclaim: () => {},

  abandonReclaim: () => {},

  release: () => {},

  prepareWorkerBranch: () => ({ branch: 'codex/issue-33-fault', mainBaseSha: 'abcdef1' }),

  checkoutWorkerBranch: () => {},
});

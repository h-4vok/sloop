const recoveryObservationKinds = [
  {
    keys: ['leaseActive', 'lease'],
    phase: 'lease',
    blocker: 'Another dispatcher owns an active run lease.',
  },
  {
    keys: ['blockedPhase', 'phase'],
    phase: 'blocked',
    blocker: 'The remote workflow phase is blocked.',
  },
  {
    keys: ['artifactMissing', 'missingArtifact'],
    phase: 'artifact',
    blocker: 'The expected run artifact is absent.',
  },
  {
    keys: ['configStale', 'configurationStale'],
    phase: 'configuration',
    blocker: 'The recorded configuration fingerprint is stale.',
  },
  {
    keys: ['checkoutDirty', 'dirtyCheckout'],
    phase: 'checkout',
    blocker: 'The checkout has uncommitted changes.',
  },
  {
    keys: ['checksFailed', 'failedChecks'],
    phase: 'checks',
    blocker: 'One or more required PR checks failed.',
  },
  {
    keys: ['prClosedUnmerged', 'closedUnmergedPr'],
    phase: 'pull request',
    blocker: 'The pull request is closed but not merged.',
  },
  {
    keys: ['schedulerDrift', 'scheduler'],
    phase: 'scheduler',
    blocker: 'The scheduler configuration or heartbeat has drifted.',
  },
];

export { recoveryObservationKinds };

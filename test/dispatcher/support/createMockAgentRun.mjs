function getAgentRole(spec) {
  if (spec.input?.includes('Use the worker skill')) return 'worker';
  if (spec.input?.includes('Use the sloop-qa skill')) return 'qa';
  if (spec.input?.includes('Use the staff-reviewer skill')) return 'staff';
  if (spec.input?.includes('Use the Arbiter contract')) return 'arbiter';
  return 'unknown';
}

export function createMockAgentRun(fixture) {
  return async (spec) => {
    fixture.runs.push(spec);
    const role = getAgentRole(spec);
    spec.onStdout?.(`${role} stdout ✓\nline two\n`);
    spec.onStderr?.(`${role} stderr\nline err\n`);
    const round = Number(spec.input?.match(/review round (\d+)/)?.[1] ?? 1);
    return runMockAgentRole(role, spec, fixture, round);
  };
}

function runMockAgentRole(role, spec, fixture, round) {
  switch (role) {
    case 'worker':
      return runMockWorker(spec, fixture, round);
    case 'qa':
      return runMockQa(fixture, round);
    case 'staff':
      return runMockStaff(fixture, round);
    case 'arbiter':
      return runMockArbiter(spec, fixture);
    default:
      return 'completed';
  }
}

function runMockWorker(spec, fixture, round) {
  fixture.workerCount += 1;
  fixture.pr.headRefOid = `abc${fixture.workerCount}`;
  if (fixture.overrides.workerCreatesPr) {
    // The Worker publishes the dispatcher-owned payload as its initial PR body.
    fixture.pr.body = spec.env.SLOOP_PR_BODY;
    fixture.createdPrBodies.push(fixture.pr.body);
  }
  spec.onStart?.(1000 + fixture.workerCount);
  spec.onHeartbeat?.();
  if (fixture.publishEvidence.worker) publishWorkerEvidence(fixture, round);
  return `WORKER_RESULT pr=${fixture.pr.number} base=main`;
}

function publishWorkerEvidence(fixture, round) {
  const verification = fixture.humanVerification
    ? '\n\n[Human Verification]\n1. Run the focused command in a temporary directory.\n2. Confirm the documented output appears.'
    : '';
  fixture.pr.comments.push({
    body: `[Worker] round=${round} status=ready_for_review pr=${fixture.pr.number} base=main commit=${fixture.pr.headRefOid}${verification}`,
    createdAt: `${fixture.workerCount}`,
  });
}

function runMockQa(fixture, round) {
  fixture.qaCount += 1;
  const verdict = fixture.qaVerdicts[fixture.qaCount - 1] ?? fixture.qaVerdicts.at(-1);
  if (fixture.publishEvidence.qa) publishQaEvidence(fixture, round, verdict);
  return 'QA completed';
}

function publishQaEvidence(fixture, round, verdict) {
  const destination =
    fixture.overrides.qaPublication === 'review' ? fixture.reviews : fixture.pr.comments;
  destination.push({
    body:
      fixture.qaBodies?.[fixture.qaCount - 1] ??
      `[QA/SDET Review] round=${round} verdict=${verdict} commit=${fixture.pr.headRefOid}`,
    commitId: fixture.pr.headRefOid,
    submittedAt: `${fixture.qaCount}`,
    createdAt: `${fixture.qaCount}`,
  });
}

function runMockStaff(fixture, round) {
  fixture.staffCount += 1;
  const verdict = fixture.staffVerdicts[fixture.staffCount - 1] ?? fixture.staffVerdicts.at(-1);
  if (fixture.publishEvidence.staff) publishStaffEvidence(fixture, round, verdict);
  return 'Staff completed';
}

function publishStaffEvidence(fixture, round, verdict) {
  fixture.reviews.push({
    body:
      fixture.staffBodies?.[fixture.staffCount - 1] ??
      `[Staff Review] round=${round} verdict=${verdict} commit=${fixture.pr.headRefOid}`,
    commitId: fixture.pr.headRefOid,
    submittedAt: `${fixture.staffCount}`,
  });
}

function runMockArbiter(spec, fixture) {
  const record = JSON.parse(spec.input.split('Record:\n')[1]);
  const decision = createArbiterDecision(fixture);
  return JSON.stringify({
    schema: 'sloop.agent-output/v1',
    context: createArbiterContext(record),
    producer: 'arbiter',
    status: decision.action,
    payload: {
      rationale: 'Conflict analysis against the contract justifies this decision.',
      references: ['QA feedback'],
      decisions: [decision],
    },
  });
}

function createArbiterContext(record) {
  return {
    run: record.state.workerRunId ?? `arbiter-${record.round}`,
    issue: record.issue.number,
    pr: record.pr.number,
    round: record.round,
    sha: record.pr.headRefOid ?? 'unknown',
    cursor: `arbiter-${record.round}`,
  };
}

function createArbiterDecision(fixture) {
  const action = fixture.overrides.arbiterAction ?? 'uphold';
  return {
    findingId: fixture.overrides.arbiterFindingId ?? 'Q1',
    owner: 'qa',
    action,
    rationale:
      'Conflict between the review arguments; analysis against contract, product and UX justifies this decision.',
    direction: 'Apply the requested correction.',
    verification: 'Run the repository gate and repeat QA.',
    ...(action === 'defer' ? { followUp: deferredArbiterFollowUp() } : {}),
  };
}

function deferredArbiterFollowUp() {
  return {
    title: 'Deferred Arbiter follow-up',
    acceptance: 'The deferred finding is implemented and verified.',
    context: 'Relevant review context and source evidence.',
  };
}

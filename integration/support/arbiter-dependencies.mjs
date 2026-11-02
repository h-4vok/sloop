import assert from 'node:assert/strict';

/** Creates isolated dependencies for the Arbiter integration scenario. */
export function createArbiterDependencies({ root, issue, pr, context, runCommand }) {
  return {
    root,

    ...createArbiterStateDependencies(context),

    ...createArbiterIssueDependencies(issue, context),

    ...createArbiterPullRequestDependencies(pr, context),

    ...createArbiterCommandDependencies(root, pr, context, runCommand),
  };
}

function createArbiterStateDependencies(context) {
  return {
    load: () => structuredClone(context.state),

    save: (next) => {
      context.state = structuredClone(next);
    },
  };
}

function createArbiterIssueDependencies(issue, context) {
  return {
    eligible: () => [issue],

    comment: (number, body) => context.issueComments.push({ number, body }),

    createIssue: () => 74,
  };
}

function createArbiterPullRequestDependencies(pr, context) {
  return {
    pullRequest: () => structuredClone(pr),

    pullRequestBody: () => pr.body,

    updatePullRequestBody: (_number, body) => {
      pr.body = body;
    },

    prComment: (number, body) => {
      assert.equal(number, pr.number);
      pr.comments.push({ body });
      if (body.startsWith('[Sloop Arbiter]')) {
        context.consumed = structuredClone(context.state);

        // Stop at first consumed ruling; this deliberate boundary ends the harness.
        throw new Error(context.boundary);
      }
    },
  };
}

function createArbiterCommandDependencies(root, pr, context, runCommand) {
  return {
    run: (spec) => runArbiterCommand(spec, root, pr, context, runCommand),

    now: () => Date.now(),

    pid: () => process.pid,

    processAlive: () => false,

    sleep: async () => {},

    onReclaim: () => {},

    tryAcquire: () => true,

    release: () => {},

    prepareWorkerBranch: () => ({ branch: pr.headRefName, mainBaseSha: 'a'.repeat(40) }),

    checkoutWorkerBranch: () => {},
  };
}

async function runArbiterCommand(spec, root, pr, context, runCommand) {
  const round = Number(spec.input?.match(/review round (\d+)/)?.[1]);
  if (spec.command === 'mock-worker') return runMockWorker(round, pr, context);
  if (spec.command === 'mock-qa') return runMockQa(round, pr, context);

  return runMockArbiter(spec, root, pr, context, runCommand);
}

function runMockWorker(round, pr, context) {
  context.workers++;
  assert.ok(context.workers <= 2, 'harness must stop before a third Worker');
  pr.headRefOid = String(context.workers).repeat(40);
  pr.comments.push({
    body: `[Worker] round=${round} status=ready_for_review pr=73 base=main commit=${pr.headRefOid}\n\nThe worker argues preserving input is sufficient; trimming was not implemented.\n\n[Human Verification]\nCall normalize with surrounding whitespace and compare the returned name.`,
  });

  return 'WORKER_RESULT pr=73 base=main';
}

function runMockQa(round, pr, context) {
  context.qa++;
  pr.reviews.push({
    body: `[QA/SDET Review] round=${round} verdict=changes_requested commit=${pr.headRefOid}\n- [Q1] fail - normalize("  Ada  ") returns "  Ada  ", expected "Ada" under issue #41. The implementation is still identity; the acceptance contract explicitly requires trimming.`,

    commitId: pr.headRefOid,

    submittedAt: new Date(context.qa * 1000).toISOString(),
  });

  return 'QA completed';
}

async function runMockArbiter(spec, root, pr, context, runCommand) {
  assert.equal(spec.command, 'codex');
  context.arbiterRuns++;
  assert.equal(context.arbiterRuns, 1);
  const record = JSON.parse(spec.input.split('Record:\n')[1]);
  context.expected = {
    run: record.state.workerRunId,

    issue: 41,

    pr: 73,

    round: 2,

    sha: pr.headRefOid,

    cursor: 'arbiter-2',
  };
  const result = await runCommand(spec, root);
  const outputIndex = spec.args.indexOf('--output-last-message');
  assert.ok(outputIndex >= 0, 'production must request a structured result file');
  context.raw = JSON.parse(
    await import('node:fs/promises').then(({ readFile }) =>
      readFile(spec.args[outputIndex + 1], 'utf8'),
    ),
  );

  return result;
}

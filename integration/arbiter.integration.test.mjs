import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, runCommand } from '../src/dispatcher.js';
import { validateAgentEnvelope } from '../src/agent-runner.js';
import { validateArbiterDecisions } from '../src/arbiter-contracts.js';

test(
  'real Codex Arbiter returns a contract accepted after two mocked Worker/QA rounds',
  { skip: process.env.SLOOP_TEST_REAL_ARBITER !== '1', timeout: 660_000 },
  async (t) => {
    // Arrange: all external state is fictional; only the Arbiter process is real.
    const root = mkdtempSync(join(tmpdir(), 'sloop-real-arbiter-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'normalize.mjs'), 'export const normalize = (value) => value;\n');
    const issue = {
      number: 41,
      title: 'Normalize surrounding whitespace in display names',
      body: 'Acceptance: normalize("  Ada  ") returns "Ada"; normalize("Ada") returns "Ada". Preserve internal spaces. Scope: string inputs only. No GitHub repository exists for this fictional issue.',
    };
    const pr = {
      number: 73,
      state: 'OPEN',
      baseRefName: 'main',
      headRefName: 'codex/issue-41',
      headRefOid: 'a'.repeat(40),
      body: 'Fictional implementation: normalize returns its input unchanged. Closes #41',
      mergeStateStatus: 'CLEAN',
      mergeable: 'MERGEABLE',
      comments: [],
      reviews: [],
      statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    };
    let state = {};
    let workers = 0;
    let qa = 0;
    let arbiterRuns = 0;
    let raw;
    let expected;
    let consumed;
    const issueComments = [];
    const boundary = 'TEST_BOUNDARY: first Arbiter ruling consumed';
    const cfg = {
      baseBranch: 'main',
      workerCommand: { command: 'mock-worker', args: [] },
      qaCommand: { command: 'mock-qa', args: [] },
      arbiterCommand: {
        command: 'codex',
        args: [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--model',
          'gpt-5.6-luna',
          '-c',
          'model_reasoning_effort=low',
        ],
        timeoutMs: 600_000,
        retries: 0,
      },
      arbiterReviewRounds: 3,
      arbiterStagnatingAppearances: 2,
      maxReviewRounds: 3,
      evidencePollIntervalMs: 0,
      evidenceTimeoutMs: 1000,
      checkPollIntervalMs: 0,
      checkTimeoutMs: 1000,
    };
    const deps = {
      root,
      load: () => structuredClone(state),
      save: (next) => {
        state = structuredClone(next);
      },
      eligible: () => [issue],
      comment: (number, body) => {
        issueComments.push({ number, body });
      },
      pullRequest: () => structuredClone(pr),
      pullRequestBody: () => pr.body,
      updatePullRequestBody: (_number, body) => {
        pr.body = body;
      },
      prComment: (number, body) => {
        assert.equal(number, pr.number);
        pr.comments.push({ body });
        if (body.startsWith('[Sloop Arbiter]')) {
          consumed = structuredClone(state);
          // Stop at the consumption boundary for ANY chosen action. Dispatch
          // records this deliberate harness stop; it is not an Arbiter failure.
          throw new Error(boundary);
        }
      },
      createIssue: () => 74,
      run: async (spec) => {
        const round = Number(spec.input?.match(/review round (\d+)/)?.[1]);
        if (spec.command === 'mock-worker') {
          workers++;
          assert.ok(workers <= 2, 'harness must stop before a third Worker');
          pr.headRefOid = String(workers).repeat(40);
          pr.comments.push({
            body: `[Worker] round=${round} status=ready_for_review pr=73 base=main commit=${pr.headRefOid}\n\nThe worker argues preserving input is sufficient; trimming was not implemented.\n\n[Human Verification]\nCall normalize with surrounding whitespace and compare the returned name.`,
          });
          return 'WORKER_RESULT pr=73 base=main';
        }
        if (spec.command === 'mock-qa') {
          qa++;
          pr.reviews.push({
            body: `[QA/SDET Review] round=${round} verdict=changes_requested commit=${pr.headRefOid}\n- [Q1] fail - normalize("  Ada  ") returns "  Ada  ", expected "Ada" under issue #41. The implementation is still identity; the acceptance contract explicitly requires trimming.`,
            commitId: pr.headRefOid,
            submittedAt: new Date(qa * 1000).toISOString(),
          });
          return 'QA completed';
        }
        assert.equal(spec.command, 'codex');
        arbiterRuns++;
        assert.equal(arbiterRuns, 1);
        const record = JSON.parse(spec.input.split('Record:\n')[1]);
        expected = {
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
        raw = JSON.parse(readFileSync(spec.args[outputIndex + 1], 'utf8'));
        t.diagnostic(`Unmodified Arbiter result: ${JSON.stringify(raw)}`);
        return result;
      },
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

    // Act: exercise the real dispatcher, schema generation, process and validators.
    await dispatch(cfg, deps);

    // Assert: no action is prescribed and no natural-language rationale is graded.
    assert.ok(raw, state.lastErrorVerbose ?? state.lastError ?? 'Arbiter produced no result');
    const envelope = validateAgentEnvelope(raw, expected);
    assert.equal(envelope.producer, 'arbiter');
    assert.ok(['uphold', 'overrule', 'defer', 'escalate'].includes(envelope.status));
    const decisions = validateArbiterDecisions(
      [{ id: 'Q1', owner: 'qa', summary: 'Whitespace acceptance' }],
      envelope.payload.decisions,
      1,
    );
    assert.ok(consumed, state.lastErrorVerbose ?? 'Dispatcher rejected the result');
    assert.equal(consumed.arbiterInterventions, 1);
    assert.deepEqual(consumed.arbiterDecisions, decisions);
    assert.equal(workers, 2);
    assert.equal(qa, 2);
    assert.equal(arbiterRuns, 1);
    assert.ok(issueComments.some(({ body }) => body.startsWith('[Sloop Arbiter]')));
    assert.ok(pr.comments.some(({ body }) => body.startsWith('[Sloop Arbiter]')));
    assert.match(state.lastErrorVerbose, /TEST_BOUNDARY: first Arbiter ruling consumed/);
  },
);

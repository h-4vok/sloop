import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'vitest';
import { runCommand } from '../../src/dispatcher.js';
import { validateAgentEnvelope } from '../../src/agent-runner.js';
import { validateArbiterDecisions } from '../../src/arbiter-contracts.js';
import { runArbiterScenario } from '../support/run-arbiter-scenario.mjs';

test(
  'real Codex Arbiter returns a contract accepted after two mocked Worker/QA rounds',
  { skip: process.env.SLOOP_TEST_REAL_ARBITER !== '1', timeout: 660_000 },
  async (t) => {
    // Arrange: fictional issue and PR; real temporary repo; Worker and QA mocked.
    const scenario = await runArbiterScenario(runCommand, (root) => {
      t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    });
    const { context, pr } = scenario;

    // Assert: protocol is validated without grading free-text rationale or prescribing action.
    assert.ok(
      context.raw,
      context.state.lastErrorVerbose ?? context.state.lastError ?? 'Arbiter produced no result',
    );
    const envelope = validateAgentEnvelope(context.raw, context.expected);
    assert.equal(envelope.producer, 'arbiter');
    assert.ok(['uphold', 'overrule', 'defer', 'escalate'].includes(envelope.status));
    const decisions = validateArbiterDecisions(
      [{ id: 'Q1', owner: 'qa', summary: 'Whitespace acceptance' }],
      envelope.payload.decisions,
      1,
    );
    assert.ok(context.consumed, context.state.lastErrorVerbose ?? 'Dispatcher rejected the result');
    assert.equal(context.consumed.arbiterInterventions, 1);
    assert.deepEqual(context.consumed.arbiterDecisions, decisions);
    assert.equal(context.workers, 2);
    assert.equal(context.qa, 2);
    assert.equal(context.arbiterRuns, 1);
    assert.ok(context.issueComments.some(({ body }) => body.startsWith('[Sloop Arbiter]')));
    assert.ok(pr.comments.some(({ body }) => body.startsWith('[Sloop Arbiter]')));
    assert.match(context.state.lastErrorVerbose, /TEST_BOUNDARY: first Arbiter ruling consumed/);
  },
);

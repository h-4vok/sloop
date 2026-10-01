import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  JsonlJournal,
  classifyFeedback,
  classifyWithRetry,
  collectHumanFeedback,
  consumeArbiterLine,
  createSession,
  event,
  formatClarificationComment,
  isReviewCurrent,
  restoreSession,
  runLoggedProcess,
} from '../src/arbiter.js';
import {
  applyArbiterDecisions,
  followUpEligible,
  followUpKey,
  shouldInvokeArbiter,
  validateArbiterDecisions,
} from '../src/arbiter-contracts.js';

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'sloop-arbiter-')), 'events.jsonl');

for (const action of ['uphold', 'overrule', 'defer', 'escalate']) {
  test(`Arbiter ${action} accepts its structural contract without grading rationale vocabulary`, () => {
    // Arrange
    const findings = [{ id: 'Q1', owner: 'qa', summary: 'Trim surrounding whitespace' }];
    const decision = {
      findingId: 'Q1',
      owner: 'qa',
      action,
      rationale: 'El requisito exige recortar los espacios.',
      direction: action === 'uphold' ? 'Trim the input.' : null,
      verification: action === 'uphold' ? 'Check surrounding and internal spaces.' : null,
      followUp:
        action === 'defer'
          ? {
              title: 'Trim names',
              acceptance: 'Surrounding spaces are removed.',
              context: 'Issue #41 / Q1',
            }
          : null,
    };
    // Act
    const state = applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, [decision]);
    // Assert
    assert.equal(state.interventions, 1);
    assert.equal(state.decisions[0].action, action);
    assert.equal(state.decisions[0].rationale, decision.rationale);
    assert.equal(state.terminal, action === 'escalate' ? 'human_review_required' : undefined);
    assert.equal(state.decisions[0].followUp, decision.followUp ?? undefined);
  });
}

const malformedDecisions = [
  ['null decision', null],
  ['array decision', []],
  ['unknown field', { extra: true }],
  ['unknown finding', { findingId: 'Q2' }],
  ['wrong owner', { owner: 'worker' }],
  ['non-string owner', { owner: 1 }],
  ['unknown action', { action: 'accept' }],
  ['non-string rationale', { rationale: 4 }],
  ['empty rationale', { rationale: ' ' }],
  ['non-string direction', { direction: 4 }],
  ['non-string verification', { verification: false }],
  ['null uphold direction', { action: 'uphold', direction: null, verification: 'Check names.' }],
  ['empty uphold direction', { action: 'uphold', direction: ' ', verification: 'Check names.' }],
  ['missing uphold verification', { action: 'uphold', direction: 'Trim names.' }],
  ['empty uphold verification', { action: 'uphold', direction: 'Trim names.', verification: ' ' }],
  ['missing defer follow-up', { action: 'defer' }],
  ['string follow-up', { action: 'defer', followUp: 'later' }],
  ['array follow-up', { action: 'defer', followUp: [] }],
  ['incomplete follow-up', { action: 'defer', followUp: { title: 'Trim names' } }],
  [
    'empty follow-up',
    { action: 'defer', followUp: { title: ' ', acceptance: 'Trim.', context: 'Q1' } },
  ],
  [
    'unknown follow-up field',
    {
      action: 'defer',
      followUp: { title: 'Trim', acceptance: 'Trim.', context: 'Q1', extra: true },
    },
  ],
];
for (const [condition, patch] of malformedDecisions) {
  test(`Arbiter rejects ${condition} before applying a ruling`, () => {
    // Arrange
    const findings = [{ id: 'Q1', owner: 'qa', summary: 'Trim names' }];
    const decision =
      patch === null || Array.isArray(patch)
        ? patch
        : {
            findingId: 'Q1',
            owner: 'qa',
            action: 'overrule',
            rationale: 'Outside the agreed scope.',
            ...patch,
          };
    // Act / Assert
    assert.throws(() =>
      applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, [decision]),
    );
  });
}

test('Arbiter rejects duplicate decisions for an open finding', () => {
  const findings = [
    { id: 'Q1', owner: 'qa', summary: 'Names' },
    { id: 'Q2', owner: 'qa', summary: 'Spaces' },
  ];
  const decision = {
    findingId: 'Q1',
    owner: 'qa',
    action: 'overrule',
    rationale: 'Outside scope.',
  };
  assert.throws(
    () => validateArbiterDecisions(findings, [decision, decision], 1),
    /finding id and owner/,
  );
});

test('Arbiter rejects uphold on the second intervention', () => {
  const findings = [{ id: 'Q1', owner: 'qa', summary: 'Names' }];
  const decision = {
    findingId: 'Q1',
    owner: 'qa',
    action: 'uphold',
    rationale: 'Trim names.',
    direction: 'Trim.',
    verification: 'Check spaces.',
  };
  assert.throws(() => validateArbiterDecisions(findings, [decision], 2), /invalid action/);
});

test('terminating arbiter validates complete atomic mixed decisions and follow-up readiness', () => {
  const findings = [
    { id: 'Q1', owner: 'qa', summary: 'scope' },
    { id: 'S1', owner: 'staff', summary: 'ux' },
  ];
  const rationale =
    'Conflict: both arguments matter. Analysis against contract, product and UX justifies this action.';
  assert.equal(shouldInvokeArbiter({ substantiveRounds: 2, findingAppearances: 1 }), false);
  assert.equal(shouldInvokeArbiter({ substantiveRounds: 3, findingAppearances: 0 }), true);
  const raw = [
    {
      findingId: 'Q1',
      owner: 'qa',
      action: 'uphold',
      rationale,
      direction: 'fix it',
      verification: 'test it',
    },
    {
      findingId: 'S1',
      owner: 'staff',
      action: 'defer',
      rationale,
      followUp: { title: 'later', acceptance: 'contract', context: 'source' },
    },
  ];
  const state = applyArbiterDecisions({ interventions: 0, decisions: [] }, findings, raw);
  assert.equal(state.decisions.length, 2);
  assert.equal(followUpKey(41, 'S1'), 'sloop/arbiter/follow-up/41/S1');
  assert.equal(followUpEligible(false, true), false);
  assert.equal(followUpEligible(true, true), true);
  assert.throws(() => validateArbiterDecisions(findings, raw.slice(0, 1), 1));
  assert.throws(() => applyArbiterDecisions({ ...state, interventions: 1 }, findings, raw));
});

test('arbiter session, events, clarification and current review contracts', () => {
  const session = createSession({ number: 7, title: 'Issue' }, 'session-1');
  assert.equal(session.status, 'running');
  const item = event({ sessionId: 'session-1', issue: 7, role: 'arbiter', type: 'x', payload: {} });
  assert.match(
    formatClarificationComment({
      ...item,
      payload: { question: 'Why?', target: 'PR', instructions: 'Explain.' },
    }),
    /Target: PR/,
  );
  assert.match(
    formatClarificationComment({ ...item, payload: {} }),
    /Please provide clarification/,
  );
  assert.equal(isReviewCurrent({ sha: 'abc', round: 2 }, 'abc', 2), true);
  assert.equal(isReviewCurrent({ sha: 'abc', round: 2 }, 'def'), false);
});

test('journal is append-only, ignores malformed records, and restores events', () => {
  const file = tempFile();
  const journal = new JsonlJournal(file);
  const first = {
    id: 'e1',
    sessionId: 's',
    issue: 1,
    type: 'review_started',
    sha: 'abc',
    round: 2,
    emittedAt: '2020-01-01T00:00:00Z',
    payload: {},
  };
  assert.equal(journal.append(first), true);
  assert.equal(journal.append(first), false);
  appendFileSync(
    file,
    'not-json\nnull\n{"id":4}\n{"id":"e2","sessionId":"s","issue":1,"type":"clarification_requested","emittedAt":"2020-01-01T00:00:01Z","payload":{"question":"Q","target":"T"}}\n',
  );
  const base = createSession({ number: 1 }, 's');
  const restored = restoreSession(base, journal);
  assert.equal(restored.review.sha, 'abc');
  assert.equal(restored.pendingClarifications[0].question, 'Q');
  assert.equal(restored.status, 'waiting_for_human_clarification');
  const minimal = restoreSession(
    { sessionId: 'none', processedEventIds: [] },
    new JsonlJournal(tempFile()),
  );
  assert.deepEqual(minimal.pendingClarifications, []);
  journal.append({
    id: 'e3',
    sessionId: 's',
    issue: 1,
    type: 'clarification_answered',
    emittedAt: '2020-01-01T00:00:02Z',
    payload: { eventId: 'e2' },
  });
  journal.append({
    id: 'e4',
    sessionId: 's',
    issue: 1,
    type: 'feedback_classified',
    emittedAt: '2020-01-01T00:00:03Z',
    payload: { classifications: [null, { sourceId: 'r' }] },
  });
  const answered = restoreSession(base, journal);
  assert.deepEqual(answered.answeredClarificationIds, ['e2']);
  assert.deepEqual(answered.classifications, [{ sourceId: 'r' }]);
  const extra = tempFile();
  const extraJournal = new JsonlJournal(extra);
  extraJournal.append({
    id: 'q',
    sessionId: 'other',
    issue: 1,
    type: 'clarification_requested',
    emittedAt: 'x',
    payload: {},
  });
  extraJournal.append({
    id: 'q2',
    sessionId: 's',
    issue: 1,
    type: 'clarification_requested',
    emittedAt: 'x',
    payload: { instructions: 'Read this' },
  });
  extraJournal.append({
    id: 'a',
    sessionId: 's',
    issue: 1,
    type: 'clarification_answered',
    emittedAt: 'x',
    payload: {},
  });
  extraJournal.append({
    id: 'f',
    sessionId: 's',
    issue: 1,
    type: 'feedback_classified',
    emittedAt: 'x',
    payload: {},
  });
  const extraRestored = restoreSession(
    { ...base, pendingClarifications: [{ eventId: 'q2' }], answeredClarificationIds: ['done'] },
    extraJournal,
  );
  assert.equal(extraRestored.pendingClarifications.length, 1);
});

test('feedback collection and classification reject unknown or invalid input', () => {
  const feedback = collectHumanFeedback({
    processedIds: ['old'],
    reviews: [
      { id: 'old', body: 'skip' },
      { id: 'r1', state: 'APPROVED', body: 'Looks good' },
      { id: 'r2', body: 'Fix this problem' },
      { body: '  ' },
    ],
    comments: [
      { id: 'c1', body: '[Staff Review] internal' },
      { id: 'c2', body: 'A concern', createdAt: 'now' },
    ],
  });
  assert.deepEqual(feedback.formalApprovals, ['r1']);
  assert.deepEqual(feedback.textualObjections, ['r2', 'c2']);
  assert.equal(feedback.items.length, 3);
  const items = [{ sourceId: 'r1' }];
  assert.throws(() => classifyFeedback(items, {}), /JSON array/);
  const result = classifyFeedback(items, [
    null,
    {},
    { sourceId: 'x', intent: 'approval', confidence: 1 },
    { sourceId: 'r1', intent: 'bad', confidence: 0.5 },
    { sourceId: 'r1', intent: 'approval', confidence: 2 },
    { sourceId: 'r1', intent: 'approval', confidence: 0.5, target: 'x', rationale: 'ok' },
    { sourceId: 'r1', intent: 'concern', confidence: '0' },
  ]);
  assert.deepEqual(result, [
    { sourceId: 'r1', intent: 'approval', confidence: 0.5, target: 'x', rationale: 'ok' },
    { sourceId: 'r1', intent: 'concern', confidence: 0, target: undefined, rationale: undefined },
  ]);
  assert.deepEqual(collectHumanFeedback({}), {
    items: [],
    formalApprovals: [],
    textualObjections: [],
  });
  const generated = collectHumanFeedback({
    reviews: [{ body: 'ok', submittedAt: 't' }],
    comments: [{ body: 'ok', createdAt: 't' }, { body: ' ' }],
  });
  assert.equal(generated.items.length, 2);
});

test('arbiter consumes only valid matching lines and classifies with retry preservation', async () => {
  const file = tempFile();
  const journal = new JsonlJournal(file);
  const session = createSession(3, 's3');
  const seen = [];
  const context = {
    session,
    journal,
    save: (value) => {
      context.saved = value;
    },
    project: (value) => seen.push(value),
  };
  const item = {
    id: 'x',
    sessionId: 's3',
    issue: 3,
    role: 'arbiter',
    type: 'worker_ready',
    sha: 'abc',
    round: 1,
    emittedAt: new Date().toISOString(),
    payload: {},
  };
  assert.equal(consumeArbiterLine(context, 'bad'), false);
  assert.equal(consumeArbiterLine(context, JSON.stringify({ ...item, issue: 4 })), false);
  assert.equal(consumeArbiterLine(context, JSON.stringify(item)), true);
  assert.equal(consumeArbiterLine(context, JSON.stringify(item)), false);
  for (const invalid of [
    null,
    { id: 'x' },
    { id: 'x', sessionId: 's3', issue: 3, role: 'a', type: 't', payload: null },
  ])
    assert.equal(
      consumeArbiterLine(
        { ...context, journal: new JsonlJournal(tempFile()) },
        JSON.stringify(invalid),
      ),
      false,
    );
  assert.equal(seen.length, 1);
  assert.equal(context.saved.review.sha, 'abc');
  const preserved = [];
  assert.deepEqual(
    await classifyWithRetry(
      [],
      async () => [],
      () => {},
    ),
    [],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => ['ok'],
      () => {},
    ),
    ['ok'],
  );
  assert.deepEqual(
    await classifyWithRetry(
      [{ sourceId: 'x' }],
      async () => {
        throw new Error('no');
      },
      (items, error) => preserved.push([items, error.message]),
    ),
    [],
  );
  assert.equal(preserved[0][1], 'no');
});

test('logged process captures streams, lines, redactions, input, timeout, and launch errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sloop-arbiter-log-'));
  const lines = [],
    errors = [];
  const base = {
    logDirectory: dir,
    sessionId: 's',
    issue: 1,
    role: 'worker',
    round: 1,
    command: process.execPath,
    args: ['-e', "process.stdout.write('hello SECRET\\nlast'); process.stderr.write('oops')"],
    timeoutMs: 1000,
    redactions: ['SECRET'],
    onStdoutLine: (line) => lines.push(line),
    onStderr: (text) => errors.push(text),
  };
  const result = await runLoggedProcess({ ...base, env: { SLOOP_TEST: '1' } });
  assert.equal(result.code, 0);
  assert.deepEqual(lines, ['hello SECRET', 'last']);
  assert.deepEqual(errors, ['oops']);
  assert.match((await import('node:fs')).readFileSync(result.logFile, 'utf8'), /\[REDACTED\]/);
  const input = await runLoggedProcess({
    ...base,
    args: ['-e', "process.stdin.on('data', d => process.stdout.write(d))"],
    input: 'input',
    onStdoutLine: undefined,
  });
  assert.equal(input.stdout, 'input');
  const newline = await runLoggedProcess({
    ...base,
    redactions: [null],
    args: ['-e', "process.stdout.write('line\\n')"],
  });
  assert.equal(newline.code, 0);
  const originalSplit = String.prototype.split;
  String.prototype.split = function (separator, limit) {
    if (separator instanceof RegExp && String(this).includes('force-empty-split')) return [];
    return originalSplit.call(this, separator, limit);
  };
  try {
    await runLoggedProcess({ ...base, args: ['-e', "process.stdout.write('force-empty-split')"] });
  } finally {
    String.prototype.split = originalSplit;
  }
  const originalReduce = Array.prototype.reduce;
  Array.prototype.reduce = function () {
    return undefined;
  };
  try {
    await runLoggedProcess({ ...base, args: ['-e', "process.stdout.write('reduce-fallback')"] });
  } finally {
    Array.prototype.reduce = originalReduce;
  }
  const timed = await runLoggedProcess({
    ...base,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    timeoutMs: 10,
  });
  assert.equal(timed.timedOut, true);
  await assert.rejects(runLoggedProcess({ ...base, command: 'definitely-not-a-real-command-xyz' }));
});

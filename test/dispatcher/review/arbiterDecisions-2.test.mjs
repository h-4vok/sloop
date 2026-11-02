import {
  assert,
  readFileSync,
  writeFileSync,
  test,
  dispatch,
  createMockDispatcherHarness,
} from '../dispatcher-test-support.mjs';
import { assertClosedSchema } from '../support/assertClosedSchema.mjs';

test('configured Codex Arbiter receives the output schema and returns its structured result', async () => {
  const scenario = await runArbiterContractScenario();

  assert.ok(scenario.schema);
  assert.match(scenario.prompt, /Do not add fields or use "version" in place of "schema"/);
  assert.match(scenario.prompt, /This is the first intervention: all four actions are allowed/);
  assert.deepEqual(JSON.parse(scenario.prompt.split('Record:\n')[1]).openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
  assert.match(scenario.prompt, /"run":"/);
  assert.equal(scenario.dispatcherHarness.state().arbiterInterventions, 1);
  assert.ok(
    scenario.dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')),
  );
});

async function runArbiterContractScenario() {
  const dispatcherHarness = createArbiterContractHarness();
  const observed = { schema: undefined, prompt: undefined };
  installArbiterContractCommand(dispatcherHarness, observed);

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  return { dispatcherHarness, ...observed };
}

function createArbiterContractHarness() {
  return createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: {
        command: 'codex',
        args: [
          'exec',
          '--sandbox',
          'read-only',
          '--output-schema',
          'stale-schema-path',
          '--output-last-message',
        ],
      },
    },
  });
}

function installArbiterContractCommand(dispatcherHarness, observed) {
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (!spec.input?.includes('Use the Arbiter contract')) return originalRun(spec);
    observed.prompt = spec.input;
    const schemaIndex = spec.args.indexOf('--output-schema');
    const outputIndex = spec.args.indexOf('--output-last-message');
    assert.notEqual(schemaIndex, -1);
    assert.notEqual(outputIndex, -1);
    observed.schema = JSON.parse(readFileSync(spec.args[schemaIndex + 1], 'utf8'));
    assertRequiredArbiterSchema(observed.schema);
    assertClosedSchema(observed.schema);
    const result = await originalRun(spec);
    writeFileSync(spec.args[outputIndex + 1], result);
    return 'Codex execution metadata is not the structured result';
  };
}

function assertRequiredArbiterSchema(schema) {
  assert.deepEqual(schema.required, ['schema', 'context', 'producer', 'status', 'payload']);
  assert.equal(schema.oneOf, undefined);
  assert.deepEqual(schema.properties.producer, { type: 'string', const: 'arbiter' });
  assert.deepEqual(schema.$defs.arbiter.required, ['rationale', 'references', 'decisions']);
  assert.equal(schema.$defs.arbiter.properties.decisions.items.additionalProperties, false);
  assert.deepEqual(schema.$defs.arbiter.properties.decisions.items.required, [
    'findingId',
    'owner',
    'action',
    'rationale',
    'direction',
    'verification',
    'followUp',
  ]);
}

test('configured Arbiter defer creates backlog follow-up without Automation Ready', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],

    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],

    arbiterAction: 'defer',

    config: {
      maxReviewRounds: 1,

      arbiterReviewRounds: 1,

      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.createdIssues.length, 1);
  assert.match(dispatcherHarness.createdIssues[0].body, /not Automation Ready/);
  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
});

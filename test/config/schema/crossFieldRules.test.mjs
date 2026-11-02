import {
  assert,
  test,
  ConfigValidationError,
  canonical,
  loadConfigText,
  parseConfig,
} from '../../support/config-test-helpers.mjs';

test('invalid documents provide exact YAML paths', () => {
  const cases = [
    [
      canonical.replace(
        'schemaVersion:\n  # Version of the tracked configuration contract.\n  1',
        'schemaVersion: 2',
      ),
      '$.schemaVersion: unsupported schema version',
    ],
    [
      canonical
        .replace(
          "expression:\n    # Platform scheduler expression.\n    ''",
          "expression:\n    # Platform scheduler expression.\n    ''",
        )
        .replace(
          'schedule:\n  enabled:\n    # Whether scheduler reconciliation is requested.\n    false',
          'schedule:\n  enabled:\n    # Whether scheduler reconciliation is requested.\n    true',
        ),
      '$.schedule.expression: is required',
    ],
  ];

  for (const [source, expected] of cases)
    assert.throws(
      () => loadConfigText(source),
      (error) => error instanceof ConfigValidationError && error.message.includes(expected),
    );
  assert.throws(() => loadConfigText('schemaVersion: ['), /\$: invalid YAML:/);
});

test('malformed containers and list fields produce validation diagnostics', () => {
  for (const [source, expected] of [
    ['schemaVersion: 1\nrepository: invalid\n', '$.repository: expected a YAML mapping'],
    ['schemaVersion: 1\nworkflow:\n  reviewOrder: qa\n', '$.workflow.reviewOrder: expected a list'],
    ['schemaVersion: 1\nworkflow: invalid\n', '$.workflow: expected a YAML mapping'],
    ['schemaVersion: 1\ngithub:\n  labels: invalid\n', '$.github.labels: expected a YAML mapping'],
  ])
    assert.throws(
      () => loadConfigText(source),
      (error) => error instanceof ConfigValidationError && error.message.includes(expected),
    );
});

const structuralViolationCases = [
  [
    'unsupported schema version',
    (value) => {
      value.schemaVersion = 2;
    },
    '$.schemaVersion',
  ],
  [
    'invalid review order',
    (value) => {
      value.workflow.reviewOrder = ['worker'];
    },
    '$.workflow.reviewOrder',
  ],
  [
    'overlapping role markers',
    (value) => {
      value.github.roleMarkers.qa = value.github.roleMarkers.worker;
    },
    '$.github.roleMarkers',
  ],
  [
    'duplicate priority labels',
    (value) => {
      value.github.labels.priority = ['p', 'p'];
    },
    '$.github.labels.priority',
  ],
  [
    'empty workspace path',
    (value) => {
      value.workspace.path = '';
    },
    '$.workspace.path',
  ],
  [
    'missing worktree root',
    (value) => {
      value.workspace.mode = 'worktree';
      value.workspace.worktreeRoot = '';
    },
    '$.workspace.worktreeRoot',
  ],
  [
    'missing schedule expression',
    (value) => {
      value.schedule.enabled = true;
      value.schedule.expression = '';
    },
    '$.schedule.expression',
  ],
  [
    'invalid Arbiter decisions',
    (value) => {
      value.arbiter.decisions = 0;
    },
    '$.arbiter.decisions',
  ],
];

test.each(structuralViolationCases)(
  'config parser rejects $1 at its path',
  (_name, mutate, expectedPath) => {
    const validConfig = JSON.parse(JSON.stringify(loadConfigText(canonical)));
    const invalidConfig = structuredClone(validConfig);
    mutate(invalidConfig);

    assert.throws(
      () => parseConfig(invalidConfig),
      (error) => error.diagnostics.some((item) => item.path === expectedPath),
    );
  },
);

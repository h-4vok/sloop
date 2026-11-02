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

test('config parser rejects structural violations at their exact paths', () => {
  const validConfig = JSON.parse(JSON.stringify(loadConfigText(canonical)));
  const invalidConfigs = [
    [
      (value) => {
        value.schemaVersion = 2;
      },
      '$.schemaVersion',
    ],
    [
      (value) => {
        value.workflow.reviewOrder = ['worker'];
      },
      '$.workflow.reviewOrder',
    ],
    [
      (value) => {
        value.github.roleMarkers.qa = value.github.roleMarkers.worker;
      },
      '$.github.roleMarkers',
    ],
    [
      (value) => {
        value.github.labels.priority = ['p', 'p'];
      },
      '$.github.labels.priority',
    ],
    [
      (value) => {
        value.workspace.path = '';
      },
      '$.workspace.path',
    ],
    [
      (value) => {
        value.workspace.mode = 'worktree';
        value.workspace.worktreeRoot = '';
      },
      '$.workspace.worktreeRoot',
    ],
    [
      (value) => {
        value.schedule.enabled = true;
        value.schedule.expression = '';
      },
      '$.schedule.expression',
    ],
    [
      (value) => {
        value.arbiter.decisions = 0;
      },
      '$.arbiter.decisions',
    ],
  ];

  for (const [mutate, configPath] of invalidConfigs) {
    const invalidConfig = structuredClone(validConfig);
    mutate(invalidConfig);

    assert.throws(
      () => parseConfig(invalidConfig),
      (error) => error.diagnostics.some((item) => item.path === configPath),
    );
  }
});

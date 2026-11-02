import {
  assert,
  test,
  runDispatcherCli,
  parseDispatcherCommand,
  createMockDispatcherHarness,
} from '../support/dispatcher-test-support.mjs';

const recoveryEligibilityCases = [
  {
    state: { issue: 31, pr: 54, status: 'worker_recovery_pending' },
    expected: {
      issue: 31,
      pr: 54,
      status: 'worker_recovery_pending',
      nextAction: {
        command: 'sloop --prepare-recovery 31 --pr 54',
        description: 'Prepare local recovery for the failed Worker.',
        mutates: true,
      },
    },
  },
  {
    state: { issue: 31, pr: 54, status: 'worker_running' },
    expected: { issue: 31, pr: 54, status: 'worker_running' },
  },
  {
    state: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
    expected: { issue: 0, pr: 54, status: 'worker_recovery_pending' },
  },
  {
    state: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
    expected: { issue: 31, pr: -1, status: 'worker_recovery_pending' },
  },
  {
    state: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
    expected: { issue: '31', pr: 54, status: 'worker_recovery_pending' },
  },
  {
    state: { issue: 31, status: 'worker_recovery_pending' },
    expected: { issue: 31, status: 'worker_recovery_pending' },
  },
];

test.each(recoveryEligibilityCases)(
  'status recommends safe recovery only for valid pending Worker context (%#)',
  async ({ state, expected }) => {
    const injected = createMockDispatcherHarness([], { initialState: state });
    let output;
    const originalLog = console.log;
    console.log = (value) => (output = value);
    try {
      const dispatcherArgs = ['--status'];
      const parsedDispatcherCommand = parseDispatcherCommand(dispatcherArgs);
      await runDispatcherCli(parsedDispatcherCommand, injected.dependencies);
    } finally {
      console.log = originalLog;
    }

    assert.deepEqual(JSON.parse(output), expected);
    assert.deepEqual(injected.state(), state);
  },
);

import {
  createIsolatedTemporaryDirectory,
  assert,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  spawnSync,
  test,
  vi,
  checkoutWorkerBranch,
  CliFailure,
  command,
  dispatch,
  eligible,
  prepareWorkerBranch,
  workerBranchName,
  withIssueClosingReference,
  artifactKey,
  runManifestMarker,
  createMockDispatcherHarness,
} from './dispatcher-test-support.mjs';

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
});

test('PR closing references preserve authorized linked issues and remove stale ones', () => {
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nClosed #99', 17, [39]),
    'Summary\n\nCloses #17\nCloses #39',
  );
});

test('review cap pauses before a replacement Worker is launched', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    config: { maxReviewRounds: 1 },
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().status, 'review_cap_pending');
  assert.equal(dispatcherHarness.state().reviewRound, 2);
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.deepEqual(dispatcherHarness.state().reviewCap.outstandingFindingIds, []);
});

test('stale remote run restores explicit HITL round and existing PR branch before Worker and QA', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,
    headRefName: 'codex/issue-1',
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1-40ae',
      workerRunId: 'replacement-run',
      status: 'worker_recovery_pending',
      reviewRound: 1,
    },
    qaVerdicts: ['passed'],
  });
  const original = {
    protocol: 1,
    runId: 'original-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1',
    baseSha: '1234567',
    configFingerprint: 'config-v1',
    phase: 'complete',
    reviewRound: 4,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'original-run' })],
  };
  const previous = {
    ...original,
    runId: 'previous-run',
    phase: 'review',
    reviewRound: 3,
    artifacts: [artifactKey('run', { issue: 1, runId: 'previous-run' })],
  };
  let current = {
    protocol: 1,
    runId: 'replacement-run',
    issue: 1,
    pr: 14,
    branch: 'codex/issue-1-40ae',
    baseSha: '1234567',
    configFingerprint: 'config-v1',
    phase: 'review',
    reviewRound: 1,
    contextCursor: '',
    artifacts: [artifactKey('run', { issue: 1, runId: 'replacement-run' })],
  };
  const comments = [
    { body: runManifestMarker(previous), createdAt: '2026-10-20T09:59:00Z' },
    { body: runManifestMarker(original), createdAt: '2026-10-20T10:00:00Z' },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=3 sha=older-sha waived=none additionalRounds=2 steer=Continue the prior request.',
      createdAt: '2026-10-20T10:00:30Z',
    },
    {
      body: '[HITL Review Cap] round=4 cap=3 sha=abc0 outstanding=Q1,Q2. Resolve with additional rounds.',
      createdAt: '2026-10-20T10:01:00Z',
    },
    {
      body: '[HITL Review Cap] action=resume issue=#1 pr=#14 round=4 sha=abc0 waived=none additionalRounds=4 steer=Fix Q1 and Q2, then request QA.',
      createdAt: '2026-10-20T10:02:00Z',
    },
  ];
  const published = [];
  let claimCount = 0;
  dispatcherHarness.dependencies.remote = {
    snapshot: () => ({
      issue: 1,
      pr: 14,
      prState: 'OPEN',
      branch: 'codex/issue-1',
      sha: 'abc0',
      manifest: current,
      markers: [`sloop/v1/run/${current.runId}`],
      comments,
      now: Date.now(),
      leaseOwner: 'this-dispatcher',
    }),
    reconcile: (_issue, key) => original.artifacts.includes(key),
    claim: () => {
      claimCount += 1;
    },
    publish: (_issue, manifest) => {
      current = manifest;
      published.push(manifest);
    },
  };
  const checkedOut = [];
  dispatcherHarness.dependencies.checkoutWorkerBranch = (branch) => checkedOut.push(branch);
  const prepared = [];
  dispatcherHarness.dependencies.prepareWorkerBranch = (issue) => {
    prepared.push(issue);
    return { branch: workerBranchName(issue), mainBaseSha: 'new-base' };
  };

  // Act
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  const workerInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';
  const qaInput =
    dispatcherHarness.runs.find((run) => run.input?.includes('Use the sloop-qa skill'))?.input ??
    '';

  assert.equal(claimCount, 0);
  assert.deepEqual(prepared, []);
  assert.deepEqual(checkedOut, ['codex/issue-1']);
  assert.match(workerInput, /review round 4/);
  assert.match(workerInput, /Fix Q1 and Q2, then request QA/);
  assert.match(qaInput, /review round 4/);
  assert.equal(dispatcherHarness.counts().workerCount, 1);
  assert.equal(dispatcherHarness.counts().qaCount, 1);
  assert.equal(dispatcherHarness.state().branch, 'codex/issue-1');
  assert.equal(dispatcherHarness.state().reviewRound, 4);
  assert.equal(dispatcherHarness.state().reviewCap.additionalRounds, 2);
  assert.equal(dispatcherHarness.state().reviewCap.steer, 'Fix Q1 and Q2, then request QA.');
  assert.ok(published.some((manifest) => manifest.phase === 'blocked'));
});

test('branch mismatch stops before Worker executes', async () => {
  // Arrange
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    prNumber: 14,
    headRefName: 'codex/issue-1',
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1-40ae',
      status: 'worker_recovery_pending',
      reviewRound: 2,
    },
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};

  // Act
  const result = await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  // Assert
  assert.equal(result, 4);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
  assert.equal(dispatcherHarness.counts().qaCount, 0);
  assert.match(
    dispatcherHarness.state().lastError,
    /refusing to launch Worker.*must use worker branch codex\/issue-1-40ae; found codex\/issue-1/,
  );
});

test('configured Arbiter upholds a finding and adds a Worker round', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
  });
  dispatcherHarness.pr.comments.push({
    body: '[Worker] round=1 status=ready_for_review pr=14 base=main commit=abc1\n\n[Human Verification]\n1. Repeat the check.',
    createdAt: '0',
  });
  dispatcherHarness.reviews.push({ body: '[Staff Review] round=1 verdict=approved commit=abc1' });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.counts().workerCount, 2);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
  assert.match(dispatcherHarness.state().lastQaFeedback, /Worker steering/);
  assert.ok(dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')));
  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
});

test('Arbiter excludes findings already closed by an overrule decision', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      status: 'worker_recovery_pending',
      reviewRound: 1,
      workerRunId: 'arbiter-filter-test',
      arbiterDecisions: [{ findingId: 'Q1', action: 'overrule' }],
    },
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - previously overruled finding\n- [Q2] fail - still open finding',
      '[QA/SDET Review] round=2 verdict=passed commit=abc2',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterStagnatingAppearances: 1,
      arbiterCommand: { command: 'codex', args: [] },
    },
    arbiterFindingId: 'Q2',
  });
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  const arbiterRun = dispatcherHarness.runs.find((spec) =>
    spec.input?.includes('Use the Arbiter contract'),
  );
  const arbiterRecord = JSON.parse(arbiterRun.input.split('Record:\n')[1]);
  assert.deepEqual(arbiterRecord.openFindings, [
    { id: 'Q2', owner: 'qa', summary: '- [Q2] fail - still open finding' },
  ]);
});

test('legacy dispatcher entry point forwards its command line to the CLI', async () => {
  const originalArgv = process.argv;
  const runCli = vi.fn(async () => {});
  vi.doMock('../../src/cli.js', () => ({ cli: { runCli } }));

  try {
    process.argv = [process.execPath, '/legacy/dispatcher.js', 'status', '--json'];
    vi.resetModules();
    await import('../../src/dispatcher.js');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(runCli.mock.calls, [[['status', '--json']]]);
  } finally {
    process.argv = originalArgv;
    vi.doUnmock('../../src/cli.js');
    vi.resetModules();
  }
});

test('configured Codex Arbiter receives the output schema and returns its structured result', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
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
  const originalRun = dispatcherHarness.dependencies.run;
  let schema;
  let prompt;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (!spec.input?.includes('Use the Arbiter contract')) return originalRun(spec);
    prompt = spec.input;
    const schemaIndex = spec.args.indexOf('--output-schema');
    const outputIndex = spec.args.indexOf('--output-last-message');
    assert.notEqual(schemaIndex, -1);
    assert.notEqual(outputIndex, -1);
    schema = JSON.parse(readFileSync(spec.args[schemaIndex + 1], 'utf8'));
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
    // Every object sent to Codex must be closed and require all its properties,
    // even within nullable objects, arrays and local references.
    const visitNode = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) assert.ok(node.$ref.startsWith('#/$defs/'));
      if (node.properties) {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      }
      if (node.enum || node.const) assert.ok(node.type);
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(visitNode);
        else visitNode(child);
      }
    };
    visitNode(schema);
    const result = await originalRun(spec);
    writeFileSync(spec.args[outputIndex + 1], result);
    return 'Codex execution metadata is not the structured result';
  };

  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.ok(schema);
  assert.match(prompt, /Do not add fields or use "version" in place of "schema"/);
  assert.match(prompt, /This is the first intervention: all four actions are allowed/);
  assert.deepEqual(JSON.parse(prompt.split('Record:\n')[1]).openFindings, [
    { id: 'Q1', owner: 'qa', summary: '- [Q1] fail - contract finding' },
  ]);
  assert.match(prompt, /"run":"/);
  assert.equal(dispatcherHarness.state().arbiterInterventions, 1);
  assert.ok(dispatcherHarness.comments.some(([, body]) => body.startsWith('[Sloop Arbiter]')));
});

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

test('configured Arbiter protocol failure stops the loop and preserves intervention budget', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    qaBodies: [
      '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n- [Q1] fail - contract finding',
    ],
    config: {
      maxReviewRounds: 1,
      arbiterReviewRounds: 1,
      arbiterCommand: { command: 'codex', args: ['exec', '--sandbox', 'read-only'] },
    },
  });
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    if (spec.input?.includes('Use the Arbiter contract')) {
      const outputIndex = spec.args.indexOf('--output-last-message');
      writeFileSync(spec.args[outputIndex + 1], '{invalid');
      return 'Codex execution metadata';
    }
    return originalRun(spec);
  };
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.equal(dispatcherHarness.state().arbiterInterventions ?? 0, 0);
  assert.match(dispatcherHarness.state().lastErrorVerbose, /Expected property name/);
});

test('a local HITL budget and steer are included in the resumed Worker context', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      workerRunId: 'resumed-worker-session',
      status: 'worker_recovery_pending',
      reviewRound: 2,
      reviewCap: {
        capRound: 1,
        additionalRounds: 1,
        waivedFindingIds: ['Q4'],
        outstandingFindingIds: ['Q4'],
        decisionSha: 'abc0',
        steer: 'Do not change GitHub configuration.',
      },
    },
    config: {
      maxReviewRounds: 1,
      workerCommand: {
        command: 'codex',
        args: ['exec', '--sandbox', 'read-only'],
        sessions: true,
      },
    },
  });
  mkdirSync(join(dispatcherHarness.root, '.sloop'), { recursive: true });
  writeFileSync(
    join(dispatcherHarness.root, '.sloop', 'sessions.json'),
    JSON.stringify({ 'resumed-worker-session\u00001\u0000worker': 'saved-session' }),
  );
  const observedRunSpecs = [];
  const originalRun = dispatcherHarness.dependencies.run;
  dispatcherHarness.dependencies.run = async (spec) => {
    observedRunSpecs.push(spec);
    return originalRun(spec);
  };
  vi.doMock('node:crypto', async (importOriginal) => {
    const crypto = await importOriginal();
    return { ...crypto, randomUUID: () => 'resumed-worker-session' };
  });
  dispatcherHarness.dependencies.checkoutWorkerBranch = () => {};
  try {
    vi.resetModules();
    const dispatcherModule = await import('../../src/dispatcher.js');
    await dispatcherModule.dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);
  } finally {
    vi.doUnmock('node:crypto');
    vi.resetModules();
  }

  assert.match(
    dispatcherHarness.runs[0].input,
    /HITL steer \(binding\): Do not change GitHub configuration/,
  );
  assert.equal(observedRunSpecs[0].env.SLOOP_SESSION, 'saved-session');
});

test('new branch preparation refuses to overwrite an existing worker branch', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit(['init', '-b', 'main']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'main');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'initial']);
  const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });

  assert.equal(remoteResult.status, 0, remoteResult.stderr);
  runGit(['remote', 'add', 'origin', remote]);
  runGit(['push', 'origin', 'main']);
  runGit(['branch', 'codex/issue-1']);
  assert.throws(
    () => prepareWorkerBranch(1, root),
    /worker branch codex\/issue-1 already exists; refusing to overwrite it/,
  );
  assert.equal(runGit(['rev-parse', 'codex/issue-1']), runGit(['rev-parse', 'HEAD']));
  rmSync(root, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
}, 15_000);

test('new branch preparation uses main updated by fetch', () => {
  const seed = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-seed-'));
  const remote = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-remote-'));
  const work = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-work-'));
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    runGit(seed, ['init', '-b', 'main']);
    runGit(seed, ['config', 'user.email', 'test@example.com']);
    runGit(seed, ['config', 'user.name', 'Test']);
    writeFileSync(join(seed, 'README.md'), 'initial');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'initial']);
    const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    assert.equal(remoteResult.status, 0, remoteResult.stderr);
    runGit(seed, ['remote', 'add', 'origin', remote]);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(work, ['clone', remote, '.']);
    writeFileSync(join(seed, 'README.md'), 'updated main');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'advance main']);
    const updatedMainSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['push', 'origin', 'main']);

    const prepared = prepareWorkerBranch(16, work);

    assert.equal(prepared.branch, 'codex/issue-16');
    assert.equal(prepared.mainBaseSha, updatedMainSha);
    assert.equal(runGit(work, ['rev-parse', 'codex/issue-16']), updatedMainSha);
  } finally {
    rmSync(seed, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}, 30_000);

test('worker branch preparation classifies a failed fetch as an external dependency failure', () => {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-git-fetch-failure-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };

  try {
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.email', 'test@example.com']);
    runGit(['config', 'user.name', 'Test']);
    writeFileSync(join(root, 'README.md'), 'main');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'initial']);
    runGit(['remote', 'add', 'origin', join(root, 'missing-remote')]);

    assert.throws(
      () => prepareWorkerBranch(31, root),
      (error) => error instanceof CliFailure && error.exitCode === 5,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test('dispatcher rejects a PR whose worker branch violates the convention', async () => {
  const dispatcherHarness = createMockDispatcherHarness(
    [{ number: 1, title: 'branch validation' }],
    {
      headRefName: 'codex/other-branch',
    },
  );
  await dispatch(dispatcherHarness.cfg, dispatcherHarness.dependencies);

  assert.match(
    dispatcherHarness.state().lastError,
    /must use worker branch codex\/issue-1; found codex\/other-branch/,
  );
});

test('dispatcher rejects a configurable non-main PR base explicitly', async () => {
  const dispatcherHarness = createMockDispatcherHarness();
  await assert.rejects(
    () =>
      dispatch({ ...dispatcherHarness.cfg, baseBranch: 'develop' }, dispatcherHarness.dependencies),
    /Worker PR baseBranch must be main; found develop/,
  );

  assert.equal(dispatcherHarness.runs.length, 0);
});

test('Worker revalidates the PR base if configuration changes during dispatch', async () => {
  const dispatcherHarness = createMockDispatcherHarness([{ number: 1, title: 'one' }]);
  const config = { ...dispatcherHarness.cfg, baseBranch: 'main' };
  dispatcherHarness.dependencies.eligible = () => {
    config.baseBranch = 'develop';
    return [{ number: 1, title: 'one' }];
  };
  const originalError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await dispatch(config, dispatcherHarness.dependencies);
  } finally {
    console.error = originalError;
  }

  assert.equal(result, 4);
  assert.match(dispatcherHarness.state().lastError, /baseBranch must be main; found develop/);
  assert.equal(dispatcherHarness.counts().workerCount, 0);
});

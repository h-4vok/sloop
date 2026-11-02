import {
  assert,
  test,
  readFileSync,
  canonical,
  runConfigCommand,
  createConfigFixture,
} from '../../support/config-test-helpers.mjs';

test('complex and canonical setters fail before changing bytes', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);

  assert.equal(await runConfigCommand(root, ['workflow.reviewOrder', 'qa', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(await runConfigCommand(root, ['github.labels.eligible', 'other', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

test('complex setters fail without changing the document', async () => {
  const { root, file } = createConfigFixture();
  const before = readFileSync(file);

  assert.equal(await runConfigCommand(root, ['skills.required', 'foo', '--no-sync']), 2);
  assert.deepEqual(readFileSync(file), before);
});

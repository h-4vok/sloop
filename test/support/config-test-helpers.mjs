import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { test, vi } from 'vitest';
import * as config from '../../src/config.js';
import * as wizard from '../../src/config-wizard.js';
import * as configServices from '../../src/application/config/index.js';
import { productionConfigReconciler } from '../../src/adapters.js';
import { parseCliCommand } from '../../src/runtime.js';
import { createIsolatedTemporaryDirectory } from './temporary-directory.mjs';
export {
  assert,
  test,
  vi,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  PassThrough,
  Writable,
  createIsolatedTemporaryDirectory,
  productionConfigReconciler,
  parseCliCommand,
};
export const {
  ConfigValidationError,
  canonicalConfigYaml,
  configFingerprint,
  configRegistry,
  configFileStore,
  loadConfigFile,
  loadConfigText,
  updateConfigFile,
  updateConfigText,
  configFileExists,
  configPaths,
  configValue,
  getConfigField,
  loadConfigTextResult,
  parseConfig,
  parseConfigResult,
  parseConfigValueResult,
  updateConfigTextResult,
} = config;
export const canonical = config.canonicalConfigYaml();
export const { reconcileConfig, runConfigCommand, setConfigValue, runConfigWizard } = wizard;
export const {
  runConfigCommand: runConfigCommandService,
  runConfigWizard: runConfigWizardService,
  setConfigValue: setConfigValueService,
} = configServices;
export function assertParserFailure(parser, value, path, matchesMessage) {
  const result = parser(value, path);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof config.ConfigValidationError);
    assert.ok(matchesMessage(result.error.message), result.error.message);
  }
}
export function createConfigWithRemote(remote) {
  return canonical.replace(
    'remote:\n    # Git remote used for Sloop branches.\n    origin',
    'remote: "' + remote + '"',
  );
}
export function createConfigFixture() {
  const root = createIsolatedTemporaryDirectory(join(tmpdir(), 'sloop-wizard-'));
  const file = join(root, 'sloop.config.yaml');
  writeFileSync(file, config.canonicalConfigYaml());
  return { root, file };
}
export function createMockScriptedIo(answers, end = true) {
  const input = new PassThrough();
  let captured = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  input.isTTY = true;
  output.isTTY = true;
  setImmediate(() => {
    let index = 0;
    const sendAnswer = () => {
      if (index < answers.length) input.write(answers[index++] + '\n');
      else if (end) input.end();
      if (!input.destroyed && index < answers.length) setTimeout(sendAnswer, 5);
    };
    sendAnswer();
  });
  return { input, output, text: () => captured };
}
export function createBlankAnswers(scope, tail) {
  return configPaths(scope)
    .filter(
      (p) => getConfigField(p) && !p.startsWith('github.labels.') && p !== 'workflow.reviewOrder',
    )
    .map(() => '')
    .concat(tail);
}

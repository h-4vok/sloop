import { test } from 'vitest';
import assert from 'node:assert/strict';
import { codexCliInvocation } from '../../src/codex-cli.js';

test('Codex CLI uses the global command directly outside Windows', () => {
  const args = ['exec', '--model', 'model-name', 'prompt text'];

  const invocation = codexCliInvocation(args, 'linux');

  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args, args);
  assert.equal(invocation.stdin, undefined);
});

test('Windows resolves the global Codex command and forwards argv as data', () => {
  const args = [
    'exec',
    '--model',
    'model-name',
    '',
    '2026-10-23T15:30:00Z',
    'prompt with $() and "quotes" ☃',
  ];

  const invocation = codexCliInvocation(args, 'win32');

  assert.equal(invocation.command, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
  assert.equal(invocation.args[3], '-EncodedCommand');
  const lines = invocation.stdin.split('\n');
  const [countLine] = lines;
  const encodedArgs = lines.slice(1, Number(countLine) + 1);
  assert.equal(Number(countLine), args.length);
  assert.equal(lines.at(-1), '');
  assert.deepEqual(
    encodedArgs.map((encoded) => Buffer.from(encoded, 'base64').toString('utf8')),
    args,
  );
  const script = Buffer.from(invocation.args[4], 'base64').toString('utf16le');
  assert.match(script, /Get-Command codex\.exe/);
  assert.match(script, /Get-Command codex\.ps1/);
  assert.match(script, /Start-Process -FilePath \$codexCommand\.Source/);
  assert.match(script, /Quote-WindowsArgument/);
  assert.match(script, /& \$codexCommand\.Source @codexArgs/);
  assert.ok(!script.includes('& codex @codexArgs'));
  assert.ok(!script.includes(args.at(-1)));
});

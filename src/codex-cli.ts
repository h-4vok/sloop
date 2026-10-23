/** Build an invocation for the Codex CLI installed by the user. */
export function codexCliInvocation(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Readonly<{ command: string; args: string[]; stdin?: string }> {
  if (platform !== 'win32') return { command: 'codex', args: [...args] };

  // Resolve the user's global command through PowerShell. Keep dynamic values
  // as base64-encoded UTF-8 lines on stdin so prompts and arguments are never
  // interpreted as shell code or converted by PowerShell's JSON date parser.
  const script = [
    'try {',
    '  $argLines = [Console]::In.ReadToEnd().Split([char]10)',
    '  $argCount = [int]$argLines[0]',
    '  $codexArgs = New-Object string[] $argCount',
    '  for ($i = 0; $i -lt $argCount; $i++) {',
    '    $encodedArg = $argLines[$i + 1].TrimEnd([char]13)',
    '    $codexArgs[$i] = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedArg))',
    '  }',
    '  & codex @codexArgs',
    '  exit $LASTEXITCODE',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 127',
    '}',
  ].join('\n');

  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    stdin: `${args.length}\n${args.map((arg) => Buffer.from(arg, 'utf8').toString('base64')).join('\n')}\n`,
  };
}

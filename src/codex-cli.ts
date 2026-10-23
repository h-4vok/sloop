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
    'function Quote-WindowsArgument([string]$value) {',
    '  $builder = New-Object System.Text.StringBuilder',
    '  [void]$builder.Append([char]34)',
    '  $slashes = 0',
    '  foreach ($character in $value.ToCharArray()) {',
    '    if ($character -eq [char]92) { $slashes++; continue }',
    '    if ($character -eq [char]34) {',
    '      [void]$builder.Append([char]92, (2 * $slashes) + 1)',
    '      [void]$builder.Append([char]34)',
    '    } else {',
    '      [void]$builder.Append([char]92, $slashes)',
    '      [void]$builder.Append($character)',
    '    }',
    '    $slashes = 0',
    '  }',
    '  [void]$builder.Append([char]92, 2 * $slashes)',
    '  [void]$builder.Append([char]34)',
    '  return $builder.ToString()',
    '}',
    'try {',
    '  $argLines = [Console]::In.ReadToEnd().Split([char]10)',
    '  $argCount = [int]$argLines[0]',
    '  $codexArgs = New-Object string[] $argCount',
    '  for ($i = 0; $i -lt $argCount; $i++) {',
    '    $encodedArg = $argLines[$i + 1].TrimEnd([char]13)',
    '    $codexArgs[$i] = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedArg))',
    '  }',
    '  $codexCommand = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($codexCommand) {',
    '    $argumentLine = [string]::Join(" ", [string[]]($codexArgs | ForEach-Object { Quote-WindowsArgument $_ }))',
    '    $child = Start-Process -FilePath $codexCommand.Source -ArgumentList $argumentLine -NoNewWindow -Wait -PassThru',
    '    exit $child.ExitCode',
    '  }',
    '  $codexCommand = Get-Command codex.ps1 -CommandType ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if (-not $codexCommand) { throw "The global Codex CLI was not found on PATH (expected codex.exe or codex.ps1)." }',
    // Windows PowerShell 5.1 drops empty values when an npm codex.ps1 shim
    // forwards argv to its native Node process, so fail clearly instead.
    '  if ($codexArgs -contains "") { throw "The global codex.ps1 shim cannot preserve empty arguments in Windows PowerShell." }',
    '  & $codexCommand.Source @codexArgs',
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

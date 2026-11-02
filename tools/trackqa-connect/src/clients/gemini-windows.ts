import { spawn } from 'node:child_process'
import path from 'node:path'
import { ConnectorError } from '../core.ts'

// Static script only: configuration bytes go over stdin, never command args.
// Windows PowerShell 5.1/.NET File.Replace preserves the destination DACL.
export const windowsSettingsScript = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$code = 'configuration_write_failed'
$lock = $null; $stream = $null; $temp = $null; $backup = $null; $ownsLock = $false
function Hash-Bytes([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function ACL-Key($acl) {
  $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  # ReplaceFile may add the informational AUTO_INHERITED flag even to a
  # protected DACL. Compare every ACE, owner, group and protection flag; ignore
  # only that bit, which does not add permissions or enable inheritance.
  $flags = [int]$raw.ControlFlags -band (-bnot [int][Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited)
  $raw.SetFlags([Security.AccessControl.ControlFlags]$flags)
  return $raw.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
}
function Private-File([string]$file) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  }
  return [IO.FileStream]::new($file, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::FullControl, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough, $acl)
}
function Check-Original {
  if ([IO.File]::Exists($file) -ne $request.exists) { throw 'conflict' }
  if ($request.exists) {
    $info = [IO.FileInfo]::new($file)
    if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'conflict' }
    if ((Hash-Bytes ([IO.File]::ReadAllBytes($file))) -cne $request.hash) { throw 'conflict' }
    if ($null -ne $originalAcl -and (ACL-Key ([IO.File]::GetAccessControl($file))) -cne (ACL-Key $originalAcl)) { throw 'conflict' }
    if ($null -ne $stamp -and ($info.CreationTimeUtc.Ticks.ToString() + ':' + $info.LastWriteTimeUtc.Ticks.ToString()) -cne $stamp) { throw 'conflict' }
  }
}
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $file = [IO.Path]::GetFullPath([string]$request.file)
  $dir = [IO.Path]::GetDirectoryName($file)
  if ([IO.Path]::GetFileName($file) -cne 'settings.json' -or ([IO.File]::GetAttributes($dir) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'conflict' }
  $lockPath = [IO.Path]::Combine($dir, '.trackqa-settings.lock')
  try { $lock = Private-File $lockPath; $ownsLock = $true } catch { $code = 'configuration_busy'; throw }
  $pidBytes = [Text.Encoding]::UTF8.GetBytes($PID.ToString()); $lock.Write($pidBytes, 0, $pidBytes.Length); $lock.Flush($true)
  $originalAcl = $null; $stamp = $null
  Check-Original
  if ($request.exists) {
    $originalAcl = [IO.File]::GetAccessControl($file)
    $info = [IO.FileInfo]::new($file)
    $stamp = $info.CreationTimeUtc.Ticks.ToString() + ':' + $info.LastWriteTimeUtc.Ticks.ToString()
  }
  $suffix = [Guid]::NewGuid().ToString('N')
  $temp = [IO.Path]::Combine($dir, '.trackqa-settings-' + $suffix + '.tmp')
  $backup = [IO.Path]::Combine($dir, '.trackqa-settings-recovery-' + $suffix + '.bak')
  $bytes = [Convert]::FromBase64String($request.bytes)
  $stream = Private-File $temp
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose(); $stream = $null }
  Check-Original
  # Commit point: no delete/truncate fallback and no automatic retry.
  if ($request.exists) { [IO.File]::Replace($temp, $file, $backup, $false) }
  else { [IO.File]::Move($temp, $file) }
  if ((Hash-Bytes ([IO.File]::ReadAllBytes($file))) -cne (Hash-Bytes $bytes)) { $code = 'configuration_write_uncertain'; throw 'postcheck' }
  if ($request.exists) {
    if ((Hash-Bytes ([IO.File]::ReadAllBytes($backup))) -cne $request.hash -or (ACL-Key ([IO.File]::GetAccessControl($file))) -cne (ACL-Key $originalAcl)) {
      $code = 'configuration_write_uncertain'; throw 'postcheck'
    }
  }
  if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
  $code = 'ok'
} catch {
  if ($_.Exception.Message -eq 'conflict') { $code = 'configuration_changed' }
  if ($null -ne $backup -and [IO.File]::Exists($backup)) {
    # Restore only to an absent destination using a no-clobber move. Never
    # overwrite a file that another writer may have created or edited.
    if (-not [IO.File]::Exists($file)) {
      try { [IO.File]::Move($backup, $file) } catch { $code = 'configuration_write_uncertain' }
    } else { $code = 'configuration_write_uncertain' }
  }
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
  if ($null -ne $temp -and [IO.File]::Exists($temp)) {
    try { [IO.File]::Delete($temp) } catch { $code = 'configuration_write_uncertain' }
  }
  if ($null -ne $lock) { $lock.Dispose() }
  if ($ownsLock) { try { [IO.File]::Delete($lockPath) } catch { $code = 'configuration_write_uncertain' } }
}
[Console]::Out.Write($code)
`

export async function commitWindowsSettings(file: string, expected: { exists: boolean; hash: string | null }, bytes: Buffer,
  spawnFn = spawn, timeoutMs = 15_000) {
  if (process.platform !== 'win32') throw new ConnectorError('client_unsupported')
  const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  await new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {}
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    const child = spawnFn(shell, ['-NoProfile', '-NonInteractive', '-Command', windowsSettingsScript], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', size = 0, settled = false
    const finish = (code: string) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (code === 'ok') resolve()
      else { child.kill(); reject(new ConnectorError(['configuration_busy', 'configuration_changed', 'configuration_write_failed'].includes(code) ? code : 'configuration_write_uncertain')) }
    }
    const timer = setTimeout(() => finish('configuration_write_uncertain'), timeoutMs)
    child.on('error', () => finish('configuration_write_uncertain'))
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', () => finish('configuration_write_uncertain'))
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 4096) finish('configuration_write_uncertain')
      else if (stream === child.stdout) output += chunk.toString('utf8')
    })
    child.on('close', code => finish(code === 0 ? output.trim() : 'configuration_write_uncertain'))
    child.stdin!.end(JSON.stringify({ file, ...expected, bytes: bytes.toString('base64') }))
  })
}

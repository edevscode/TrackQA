import { spawn } from 'node:child_process'
import path from 'node:path'
import { open, unlink } from 'node:fs/promises'
import { capture } from '../process.ts'
import { ConnectorError, requireValue } from '../core.ts'
import { readVSCodeFile, writeVSCodeFile } from './vscode-session.ts'

export type CodeProcess = { pid: number; created: string; owned: boolean }
const shell = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
const helperEnvironment = () => Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
export async function codeProcesses(user: string): Promise<CodeProcess[]> {
  requireValue(process.platform === 'win32', 'client_unsupported')
  const command = `$dir=${quote(user)}; @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');owned=[bool]($_.CommandLine -and $_.CommandLine.Contains($dir))} }) | ConvertTo-Json -Compress`
  try {
    const raw = await capture(shell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], helperEnvironment())
    const rows = raw.trim() ? JSON.parse(raw) : []
    requireValue(Array.isArray(rows) && rows.length < 1000 && rows.every(row => Number.isSafeInteger(row.pid) && row.pid > 0 && typeof row.created === 'string' && typeof row.owned === 'boolean'), 'vscode_process_unconfirmed')
    return rows
  } catch { throw new ConnectorError('vscode_process_unconfirmed') }
}
async function closeOwnedWindow(user: string, process: CodeProcess) {
  // No forced process/tree kill. Recheck identity and the private user-data path.
  const command = `$p=Get-CimInstance Win32_Process -Filter ${quote('ProcessId = ' + process.pid)} -ErrorAction Stop; if ($p -and $p.Name -ceq 'Code.exe' -and $p.CreationDate.ToUniversalTime().ToString('o') -ceq ${quote(process.created)} -and $p.CommandLine.Contains(${quote(user)})) { [void](Get-Process -Id ${process.pid} -ErrorAction Stop).CloseMainWindow() }`
  await capture(shell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], helperEnvironment())
}
type RunRecord = { version: 1; phase: 'launching' | 'running'; baseline: CodeProcess[] }
export type VSCodeRuntime = { snapshot: typeof codeProcesses; close: typeof closeOwnedWindow; spawn: typeof spawn; graceMs?: number }
export const vscodeRuntime: VSCodeRuntime = { snapshot: codeProcesses, close: closeOwnedWindow, spawn }
const identity = (row: CodeProcess) => `${row.pid}:${row.created}`
async function runRecord(file: string) {
  const bytes = await readVSCodeFile(file)
  if (!bytes) return null
  let record: RunRecord
  try { record = JSON.parse(bytes.toString('utf8')) } catch { throw new ConnectorError('vscode_process_unconfirmed') }
  requireValue(record && Object.keys(record).sort().join(',') === 'baseline,phase,version' && record.version === 1
    && ['launching', 'running'].includes(record.phase) && Array.isArray(record.baseline)
    && record.baseline.every(row => Object.keys(row).sort().join(',') === 'created,owned,pid' && Number.isSafeInteger(row.pid)
      && row.pid > 0 && typeof row.created === 'string' && typeof row.owned === 'boolean'), 'vscode_process_unconfirmed')
  return record
}
export async function settleVSCodeRun(file: string, user: string, runtime = vscodeRuntime) {
  const record = await runRecord(file)
  if (!record) return
  // A crash in the spawn/acknowledgement gap cannot be automatically settled.
  requireValue(record.phase === 'running', 'vscode_process_unconfirmed')
  const baseline = new Set(record.baseline.map(identity)), rows = await runtime.snapshot(user)
  requireValue(rows.every(row => !row.owned && baseline.has(identity(row))), 'vscode_process_unconfirmed')
  await unlink(file)
}
export async function launchVSCode(executable: string, args: string[], env: NodeJS.ProcessEnv, user: string, file: string, signal?: AbortSignal, runtime = vscodeRuntime) {
  requireValue(!signal?.aborted, 'interrupted')
  const baseline = await runtime.snapshot(user)
  requireValue(baseline.length < 100 && !baseline.some(row => row.owned), 'vscode_process_unconfirmed')
  const record: RunRecord = { version: 1, phase: 'launching', baseline }
  await writeVSCodeFile(file, Buffer.from(JSON.stringify(record)))
  if (signal?.aborted) { await unlink(file); throw new ConnectorError('interrupted') }
  let child: ReturnType<typeof spawn>
  try { child = runtime.spawn(executable, args, { env, cwd: path.dirname(user), windowsHide: false, stdio: 'ignore' }) }
  catch { await unlink(file); throw new ConnectorError('client_launch_failed') }
  // spawn copies the environment synchronously. Never retain its token reference.
  for (const key of Object.keys(env)) if (/^TRACKQA_MCP_/.test(key)) delete env[key]
  let failure: ConnectorError | undefined, stopping = false, exited = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let completeCleanup = () => {}
  const complete = new Promise<void>(resolve => {
    const stop = () => {
      if (stopping || exited) return
      stopping = true
      void runtime.snapshot(user).then(rows => Promise.all(rows.filter(row => row.pid === child.pid && row.owned && !baseline.some(old => identity(old) === identity(row))).map(row => runtime.close(user, row)))).catch(() => {})
      timer = setTimeout(() => { failure = new ConnectorError('vscode_process_unconfirmed'); resolve() }, runtime.graceMs ?? 5000)
    }
    signal?.addEventListener('abort', stop, { once: true })
    child.once('error', () => { exited = true; failure = new ConnectorError('client_launch_failed'); resolve() })
    child.once('exit', code => { exited = true; if (code !== 0) failure = new ConnectorError('client_exit_failed'); resolve() })
    if (signal?.aborted) stop()
    completeCleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
  })
  try {
    // A partial acknowledgement fails closed on recovery; no token is written.
    const handle = await open(file, 'r+')
    try { await handle.truncate(0); await handle.writeFile(JSON.stringify({ ...record, phase: 'running' })); await handle.sync() }
    finally { await handle.close() }
    await complete
  } catch { throw new ConnectorError('vscode_process_unconfirmed') }
  finally { completeCleanup() }
  // Main-process exit alone is insufficient. Any newly observed Code process
  // (even an unrelated new instance) makes cleanup uncertain; none is killed.
  await settleVSCodeRun(file, user, runtime)
  if (failure) throw failure
  requireValue(!signal?.aborted, 'interrupted')
}

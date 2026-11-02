import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { ConnectorError } from './core.ts'

export const spawnProcess = spawn
export function clientEnvironment(codexHome: string, env: NodeJS.ProcessEnv = process.env) {
  const clean: NodeJS.ProcessEnv = { CODEX_HOME: codexHome, RUST_LOG: 'off' }
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'OPENAI_API_KEY']) {
    if (env[key]) clean[key] = env[key]
  }
  return clean
}
// stdout/stderr are bounded and never forwarded. Native client diagnostics may
// contain unrelated configuration secrets. Callers receive only sanitized errors.
export async function capture(executable: string, args: string[], env: NodeJS.ProcessEnv, spawnFn = spawnProcess) {
  return new Promise<string>((resolve, reject) => {
    let output = '', size = 0, settled = false
    const child = spawnFn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) { child.kill(); reject(error) } else resolve(output)
    }
    const timer = setTimeout(() => finish(new ConnectorError('client_command_timeout')), 15_000)
    child.on('error', () => finish(new ConnectorError('client_command_failed')))
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('error', () => finish(new ConnectorError('client_command_failed')))
      stream?.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_048_576) finish(new ConnectorError('client_response_limit'))
        else if (stream === child.stdout) output += chunk.toString('utf8')
      })
    }
    child.on('close', code => finish(code === 0 ? undefined : new ConnectorError('client_command_failed')))
  })
}
export async function foreground(executable: string, env: NodeJS.ProcessEnv, signal?: AbortSignal, spawnFn = spawnProcess, args: readonly string[] = []) {
  if (signal?.aborted) throw new ConnectorError('interrupted')
  await new Promise<void>((resolve, reject) => {
    const options: SpawnOptions = { env, stdio: 'inherit', windowsHide: false }
    const child = spawnFn(executable, [...args], options)
    let settled = false, stopping = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      if (stopping || settled) return
      stopping = true
      child.kill('SIGTERM')
      timer = setTimeout(() => { child.kill('SIGKILL'); finish(new ConnectorError('interrupted')) }, 3000)
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', () => finish(new ConnectorError('client_launch_failed')))
    child.on('exit', code => finish(signal?.aborted ? new ConnectorError('interrupted') : code === 0 ? undefined : new ConnectorError('client_exit_failed')))
    if (signal?.aborted) abort()
  })
}

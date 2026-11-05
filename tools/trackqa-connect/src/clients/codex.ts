import { realpath, stat, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { capture, clientEnvironment, foreground } from '../process.ts'
import { ConnectorError, requireValue } from '../core.ts'
import type { Setup } from '../core.ts'
import { verifyCodex } from './codex-verify.ts'
import type { Adapter } from './adapter.ts'
export type { Adapter } from './adapter.ts'

export function trustedLocation(file: string, home = os.homedir(), platform = process.platform, cwd = process.cwd()) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const normalized = paths.resolve(file).toLowerCase()
  const within = (root: string) => normalized.startsWith(paths.resolve(root).toLowerCase() + paths.sep)
  const workspace = paths.resolve(cwd).toLowerCase(), relative = paths.relative(workspace, normalized)
  const inWorkspace = relative === '' || (relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  if (!paths.isAbsolute(file) || (inWorkspace && workspace !== paths.resolve(home).toLowerCase())) return false
  if (platform === 'win32') {
    if (paths.basename(file).toLowerCase() !== 'codex.exe') return false
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return within(programFiles) || within(paths.join(home, 'AppData', 'Local', 'Programs'))
      || within(paths.join(home, '.codex', 'bin'))
      || ['.vscode', '.vscode-insiders', '.antigravity-ide'].some(editor => {
        const base = paths.join(home, editor, 'extensions')
        return within(base) && /^openai\.chatgpt-[^\\/]+[\\/]bin[\\/]/i.test(paths.relative(base, file))
      })
  }
  return ['/usr/bin', '/usr/local/bin', '/opt', paths.join(home, '.local', 'bin'), paths.join(home, '.codex', 'bin')].some(within)
}
export type Executable = { path: string; sha256: string; version: string; appServer: boolean; foregroundMode: 'no-daemon' | 'direct' | 'unsupported' }
export function editorBundled(file: string) {
  return /\/\.(?:vscode(?:-insiders)?|antigravity-ide)\/extensions\/openai\.chatgpt-[^/]+\/bin\//i.test(file.replaceAll('\\', '/'))
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export async function checkExecutable(file: string) {
  requireValue(path.isAbsolute(file) && trustedLocation(file), 'executable_untrusted')
  const canonical = await realpath(file)
  requireValue(trustedLocation(canonical) && (process.platform !== 'win32' || path.resolve(canonical).toLowerCase() === path.resolve(file).toLowerCase()), 'executable_untrusted')
  const info = await stat(canonical)
  requireValue(info.isFile() && (process.platform === 'win32' || !(info.mode & 0o022)), 'executable_untrusted')
  return { path: canonical, sha256: sha(await readFile(canonical)) }
}
export async function detectCodex(codexHome: string, explicit?: string, env = process.env, run = capture, inspect = checkExecutable): Promise<Executable> {
  const candidates = explicit ? [explicit] : (env.PATH ?? '').split(path.delimiter).filter(folder => path.isAbsolute(folder))
    .map(folder => path.join(folder, process.platform === 'win32' ? 'codex.exe' : 'codex'))
  if (!explicit && env.PATH && process.platform === 'win32') {
    candidates.push(path.join(os.homedir(), '.codex', 'bin', 'codex.exe'))
    // Known publisher paths only: do not recursively scan arbitrary workspaces.
    for (const editor of ['.vscode', '.vscode-insiders', '.antigravity-ide']) {
      const folder = path.join(os.homedir(), editor, 'extensions')
      const extensions = await readdir(folder).catch(() => [] as string[])
      for (const extension of extensions.filter(name => /^openai\.chatgpt-[A-Za-z0-9.-]+$/.test(name)).sort().reverse()) {
        candidates.push(path.join(folder, extension, 'bin', `windows-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`, 'codex.exe'))
      }
    }
  }
  const childEnv = clientEnvironment(codexHome, env)
  // Prefer an installed native CLI over an editor's partial package. Explicit
  // selections are respected; never silently replace the executable requested.
  const ordered = explicit ? candidates : [...new Map(candidates.map(file => [process.platform === 'win32' ? file.toLowerCase() : file, file])).values()]
    .sort((a, b) => Number(editorBundled(a)) - Number(editorBundled(b)))
  let fallback: Executable | undefined
  let unsupported: unknown
  for (const candidate of ordered) {
    let executable: Awaited<ReturnType<typeof checkExecutable>>
    try { executable = await inspect(candidate) }
    catch { if (explicit) throw new ConnectorError('executable_untrusted'); continue }
    try {
      const version = /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*$/.exec((await run(executable.path, ['--version'], childEnv)).trim())?.[1]
      requireValue(version, 'client_unsupported')
      // Capabilities, rather than an invented version threshold, determine support.
      for (const [args, expected] of [
        [['mcp', 'add', '--help'], ['--url', '--bearer-token-env-var']],
        [['mcp', 'get', '--help'], ['--json']], [['mcp', 'list', '--help'], ['--json']],
        [['mcp', 'remove', '--help'], ['NAME']],
      ] as [string[], string[]][]) {
        const help = await run(executable.path, args, childEnv)
        requireValue(expected.every(flag => help.includes(flag)), 'client_unsupported')
      }
      const help = await run(executable.path, ['--help'], childEnv)
      let foregroundMode: Executable['foregroundMode'] = editorBundled(executable.path) ? 'unsupported' : 'direct'
      if (/--no-daemon\b/.test(help)) {
        // Help must both advertise the option and accept it. Do not optimistically
        // retry a failed interactive session with a second credentialed process.
        foregroundMode = 'unsupported'
        try { await run(executable.path, ['--no-daemon', '--help'], childEnv); foregroundMode = 'no-daemon' } catch { /* Clear pre-auth diagnostic below. */ }
      }
      let appServer = false
      try { appServer = /app.server/.test(await run(executable.path, ['app-server', '--stdio', '--help'], childEnv)) } catch { /* Manual verification remains available. */ }
      requireValue(sha(await readFile(executable.path)) === executable.sha256, 'executable_changed')
      const detected = { ...executable, version, appServer, foregroundMode }
      if (foregroundMode !== 'unsupported' || explicit) return detected
      fallback ??= detected // Status/disconnect must remain usable for recovery.
    } catch (error) {
      if (explicit || (error instanceof ConnectorError && error.code === 'executable_changed')) throw error
      unsupported = error
    }
  }
  if (fallback) return fallback
  if (unsupported) throw unsupported
  throw new ConnectorError('client_not_found')
}
export function fingerprint(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stable(value)])) : item
  return sha(Buffer.from(JSON.stringify(stable(value))))
}
export function matchesEntry(value: unknown, setup: Setup) {
  if (!value || typeof value !== 'object') return false
  const entry = value as { name?: string; enabled?: boolean; transport?: { type?: string; url?: string; bearer_token_env_var?: string; http_headers?: object; env_http_headers?: object } }
  const transport = entry.transport
  return entry.name === setup.serverName && entry.enabled === true && transport?.type === 'streamable_http'
    && transport.url === setup.endpoint && transport.bearer_token_env_var === setup.envVar
    && !Object.keys(transport.http_headers ?? {}).length && !Object.keys(transport.env_http_headers ?? {}).length
}
export function codexAdapter(executable: Executable, codexHome: string, run = capture, environment = process.env, launchForeground = foreground): Adapter {
  const env = clientEnvironment(codexHome, environment)
  async function assertIntegrity() { requireValue(sha(await readFile(executable.path)) === executable.sha256, 'executable_changed') }
  async function command(args: string[]) { await assertIntegrity(); return run(executable.path, args, env) }
  async function entry(setup: Setup) {
    let rows: unknown
    try { rows = JSON.parse(await command(['mcp', 'list', '--json'])) } catch { throw new ConnectorError('configuration_unreadable') }
    requireValue(Array.isArray(rows) && rows.every(row => typeof row.name === 'string'), 'configuration_unreadable')
    if (!rows.some(row => row.name === setup.serverName)) return null
    try { return JSON.parse(await command(['mcp', 'get', setup.serverName, '--json'])) } catch { throw new ConnectorError('configuration_unreadable') }
  }
  return {
    executable, codexHome, entry,
    async install(setup) {
      requireValue(await entry(setup) === null, 'configuration_conflict')
      await command(['mcp', 'add', setup.serverName, '--url', setup.endpoint, '--bearer-token-env-var', setup.envVar])
      const installed = await entry(setup)
      requireValue(matchesEntry(installed, setup), 'installation_unconfirmed')
      return fingerprint(installed)
    },
    async remove(setup, hash) {
      const installed = await entry(setup)
      if (installed === null) return
      requireValue(hash && matchesEntry(installed, setup) && fingerprint(installed) === hash, 'configuration_changed')
      await command(['mcp', 'remove', setup.serverName])
      requireValue(await entry(setup) === null, 'removal_unconfirmed')
    },
    async launch(setup, token, signal) {
      requireValue(executable.foregroundMode === 'no-daemon' || executable.foregroundMode === 'direct', 'client_foreground_unsupported')
      await assertIntegrity()
      const childEnv = { ...env, [setup.envVar]: token }
      token = ''
      try {
        const running = launchForeground(executable.path, childEnv, signal, undefined, executable.foregroundMode === 'no-daemon' ? ['--no-daemon'] : [])
        delete childEnv[setup.envVar] // spawn has copied the environment into the child.
        await running
      }
      finally { delete childEnv[setup.envVar] }
    },
    async verify(setup, token, signal) {
      await assertIntegrity()
      if (!executable.appServer) return { authorized: null, verified: false, code: 'manual_verification_required' }
      return verifyCodex(executable.path, codexHome, setup, token, signal)
    },
  }
}

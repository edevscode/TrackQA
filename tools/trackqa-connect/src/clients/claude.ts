import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { capture, foreground } from '../process.ts'
import { ConnectorError, requireValue, TOKEN, tools } from '../core.ts'
import type { Setup } from '../core.ts'
import type { Adapter } from './adapter.ts'
import type { Executable } from './codex.ts'
import { commitWindowsSettings } from './gemini-windows.ts'
import { claudeSessionPath, installClaudeSession, matchesClaudeEntry, readClaudeSession, removeClaudeSession } from './claude-session.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export type ClaudeExecutable = Executable & { strictMcp: boolean }
export function trustedClaudeLocation(file: string, home = os.homedir(), platform = process.platform, cwd = process.cwd()) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(file) || paths.basename(file).toLowerCase() !== 'claude.exe' || platform !== 'win32') return false
  const within = (root: string) => paths.resolve(file).toLowerCase().startsWith(paths.resolve(root).toLowerCase() + paths.sep)
  const workspace = paths.resolve(cwd).toLowerCase(), relative = paths.relative(workspace, paths.resolve(file).toLowerCase())
  const inWorkspace = relative === '' || (relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  if (inWorkspace && workspace !== paths.resolve(home).toLowerCase()) return false
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return [paths.join(home, '.local', 'bin'), paths.join(home, '.local', 'share', 'claude', 'versions'),
    paths.join(programFiles, 'ClaudeCode')].some(within)
    || (within(paths.join(programFiles, 'WinGet', 'Packages'))
      && /^Anthropic\.ClaudeCode_[A-Za-z0-9._-]+[\\/]/.test(paths.relative(paths.join(programFiles, 'WinGet', 'Packages'), file)))
}
export async function checkClaudeExecutable(file: string) {
  requireValue(trustedClaudeLocation(file), 'executable_untrusted')
  const canonical = await realpath(file)
  requireValue(trustedClaudeLocation(canonical), 'executable_untrusted')
  const info = await lstat(canonical)
  requireValue(info.isFile() && !info.isSymbolicLink(), 'executable_untrusted')
  return { path: canonical, sha256: sha(await readFile(canonical)) }
}
export function claudeEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = { DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' }
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
    'TERM', 'COLORTERM', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
    'NODE_USE_SYSTEM_CA', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH']) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  // Claude manages its own account cache. No ambient provider keys, Owner Auth,
  // MCP tokens, debug destinations, NODE_OPTIONS or TLS-disable settings pass.
  return env
}
export async function detectClaude(explicit?: string, source = process.env, run = capture, inspect = checkClaudeExecutable): Promise<ClaudeExecutable> {
  const candidates = explicit ? [explicit] : [...new Set([
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    ...(source.PATH ?? '').split(path.delimiter).filter(folder => path.isAbsolute(folder)).map(folder => path.join(folder, 'claude.exe')),
  ])]
  let incompatible = false
  for (const candidate of candidates) {
    let exe: Awaited<ReturnType<typeof checkClaudeExecutable>>
    try { exe = await inspect(candidate) }
    catch { if (explicit) throw new ConnectorError('executable_untrusted'); continue }
    // Help/version only, private disposable config, no native add/remove or login.
    const root = await mkdtemp(path.join(os.tmpdir(), 'trackqa-claude-probe-'))
    try {
      const env = { ...claudeEnvironment(source), CLAUDE_CONFIG_DIR: root }
      const version = /^(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s+\(Claude Code\)$/.exec((await run(exe.path, ['--version'], env, undefined, root)).trim())?.[1]
      requireValue(version, 'client_unsupported')
      const help = await run(exe.path, ['--help'], env, undefined, root)
      requireValue(help.includes('--mcp-config'), 'client_unsupported')
      requireValue(sha(await readFile(exe.path)) === exe.sha256, 'executable_changed')
      return { ...exe, version, appServer: false, foregroundMode: 'direct', strictMcp: help.includes('--strict-mcp-config') }
    } catch (error) {
      if (explicit || (error instanceof ConnectorError && error.code === 'executable_changed')) throw error
      incompatible = true
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  throw new ConnectorError(incompatible ? 'client_unsupported' : 'client_not_found')
}
export const claudeLaunchArgs = (file: string, strict = false) => ['--mcp-config', file, ...(strict ? ['--strict-mcp-config'] : [])]
export const claudeVerification = () => ({ authorized: null, verified: false, code: 'manual_verification_required' })
export function claudeInstructions(setup: Setup) {
  return `Claude Code native header expansion, discovery and authenticated reads are not yet verified. Claude account sign-in is separate from TrackQA. Use /mcp to check this server and exactly these five tools: ${tools.join(', ')}. Call only trackqa_connection_status and trackqa_list_projects; confirm only project ${setup.projectId}. Do not submit a finding. Exit with /exit for revocation and cleanup. Manual observations do not change the connector's unverified result.`
}
export function claudeAdapter(exe: ClaudeExecutable, sessionHome: string, source = process.env, strict = false, launchForeground = foreground, commit = commitWindowsSettings): Adapter {
  requireValue(!strict || exe.strictMcp, 'client_unsupported')
  const entry = (setup: Setup) => readClaudeSession(sessionHome, setup)
  const integrity = async () => requireValue(await realpath(exe.path) === exe.path && sha(await readFile(exe.path)) === exe.sha256, 'executable_changed')
  return {
    client: 'claude', label: 'Claude Code', configurationHome: sessionHome, executable: exe, entry, matches: matchesClaudeEntry,
    installPreview: setup => `Session-only private token-free file: ${claudeSessionPath(sessionHome, setup)}; --mcp-config${strict ? ' --strict-mcp-config (explicit TrackQA-only session: excludes other configured MCP servers for this session)' : ' (other MCP configuration is preserved and may also load)'}`,
    manualInstructions: claudeInstructions,
    async install(setup) { await integrity(); return installClaudeSession(sessionHome, setup, commit) },
    async remove(setup, hash) { await removeClaudeSession(sessionHome, setup, hash) },
    async verify() { return claudeVerification() },
    async launch(setup, token, signal) {
      requireValue(TOKEN.test(token), 'token_invalid')
      requireValue(await entry(setup) !== null, 'configuration_changed')
      await integrity()
      const env = { ...claudeEnvironment(source), [setup.envVar]: token }; token = ''
      try {
        const running = launchForeground(exe.path, env, signal, undefined, claudeLaunchArgs(claudeSessionPath(sessionHome, setup), strict))
        delete env[setup.envVar]
        await running
      } finally { delete env[setup.envVar] }
    },
  }
}

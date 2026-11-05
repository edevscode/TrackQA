import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ConnectorError, requireValue, TOKEN, tools } from '../core.ts'
import type { Setup } from '../core.ts'
import type { Adapter } from './adapter.ts'
import type { Executable } from './codex.ts'
import { installVSCodeSession, matchesVSCodeEntry, readVSCodeFile, readVSCodeSession, removeVSCodeSession, vscodePaths, vscodePayloads } from './vscode-session.ts'
import { launchVSCode, settleVSCodeRun, vscodeRuntime } from './vscode-process.ts'
import type { VSCodeRuntime } from './vscode-process.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export type VSCodeExecutable = Executable & { inputs: { path: string; sha256: string }[]; installation: string }
export function trustedVSCodeLocation(file: string, home = os.homedir(), platform = process.platform, cwd = process.cwd()) {
  if (platform !== 'win32') return false
  const paths = path.win32, resolved = paths.resolve(file).toLowerCase()
  const workspace = paths.resolve(cwd).toLowerCase(), relative = paths.relative(workspace, resolved)
  const inWorkspace = relative === '' || (relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  if (!paths.isAbsolute(file) || paths.basename(file).toLowerCase() !== 'code.exe' || (inWorkspace && workspace !== paths.resolve(home).toLowerCase())) return false
  return [paths.join(home, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    paths.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe')].some(candidate => paths.resolve(candidate).toLowerCase() === resolved)
}
async function regular(file: string) {
  const stat = await lstat(file)
  requireValue(stat.isFile() && !stat.isSymbolicLink() && (await realpath(file)).toLowerCase() === path.resolve(file).toLowerCase(), 'executable_untrusted')
  return { path: file, sha256: sha(await readFile(file)) }
}
export async function checkVSCodeExecutable(file: string, trust = trustedVSCodeLocation): Promise<VSCodeExecutable> {
  requireValue(trust(file), 'executable_untrusted')
  const canonical = await realpath(file)
  requireValue(trust(canonical), 'executable_untrusted')
  const installation = path.dirname(canonical)
  requireValue(!await lstat(path.join(installation, 'data')).catch(error => { if (error.code === 'ENOENT') return null; throw error }), 'client_unsupported')
  const wrapper = path.join(installation, 'bin', 'code.cmd'), text = await readFile(wrapper, 'utf8')
  const versionFolder = /%~dp0\.\.\\([0-9a-f]{10})\\resources\\app\\out\\cli\.js/.exec(text)?.[1]
  requireValue(versionFolder || text.includes('%~dp0..\\resources\\app\\out\\cli.js'), 'client_unsupported')
  const app = path.join(installation, ...(versionFolder ? [versionFolder] : []), 'resources', 'app')
  const productFile = path.join(app, 'product.json'), packageFile = path.join(app, 'package.json'), cliFile = path.join(app, 'out', 'cli.js')
  const product = JSON.parse(await readFile(productFile, 'utf8')), pkg = JSON.parse(await readFile(packageFile, 'utf8'))
  requireValue(product.applicationName === 'code' && product.quality === 'stable' && product.version === pkg.version && /^1\.143\.\d+$/.test(pkg.version), 'client_unsupported')
  const cli = await readFile(cliFile, 'utf8')
  for (const flag of ['user-data-dir', 'extensions-dir', 'use-inmemory-secretstorage', 'disable-updates']) requireValue(cli.includes(flag), 'client_unsupported')
  const inputs = await Promise.all([canonical, wrapper, productFile, packageFile, cliFile].map(regular))
  return { path: canonical, sha256: inputs[0].sha256, version: pkg.version, appServer: false, foregroundMode: 'direct', inputs, installation }
}
export async function detectVSCode(explicit?: string, source = process.env, inspect = checkVSCodeExecutable): Promise<VSCodeExecutable> {
  const candidates = explicit ? [explicit] : [path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(source.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe')]
  for (const candidate of candidates) {
    try { return await inspect(candidate) } catch (error) {
      if (explicit || error instanceof ConnectorError && error.code === 'client_unsupported') throw error instanceof ConnectorError ? error : new ConnectorError('executable_untrusted')
    }
  }
  throw new ConnectorError('client_not_found')
}
export function vscodeEnvironment(home: string, setup: Setup, source: NodeJS.ProcessEnv = process.env) {
  const files = vscodePaths(home, setup), clean: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'WINDIR', 'COMSPEC', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL',
    'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_SYSTEM_CA', 'NODE_EXTRA_CA_CERTS']) {
    if (source[key] !== undefined) clean[key] = source[key]
  }
  return { ...clean, HOME: files.home, USERPROFILE: files.home, APPDATA: path.join(files.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(files.home, 'AppData', 'Local'), TEMP: path.join(files.home, 'Temp'), TMP: path.join(files.home, 'Temp'), VSCODE_DISABLE_TELEMETRY: '1' }
}
export function vscodeLaunchArgs(home: string, setup: Setup) {
  const files = vscodePaths(home, setup)
  return ['--new-window', '--user-data-dir', files.user, '--extensions-dir', files.extensions, '--skip-welcome', '--skip-release-notes',
    '--disable-updates', '--disable-telemetry', '--sync', 'off', '--use-inmemory-secretstorage', '--log', 'warning']
}
export const vscodeVerification = () => ({ authorized: null, verified: false, code: 'manual_verification_required' })
export function vscodeInstructions(setup: Setup) {
  return `Experimental VS Code Local harness only. In the window titled TrackQA Local, use Ctrl+Shift+P > MCP: List Servers > ${setup.serverName} > Start Server. Trust only this server if asked; inspect its Show Output action. Startup alone is not verification. Confirm Running and these five tools: ${tools.join(', ')}. In a separately authorized Local agent session, call only trackqa_connection_status and trackqa_list_projects and confirm project ${setup.projectId}. Do not submit a finding during acceptance. Account/model access is separate; do not switch to Copilot or provider harnesses. Use File > Exit to close the entire isolated instance, then return here for revocation. Manual observations remain unverified by this CLI.`
}
export function vscodeAdapter(exe: VSCodeExecutable, sessionHome: string, source = process.env, runtime: VSCodeRuntime = vscodeRuntime): Adapter {
  async function integrity() {
    requireValue(!await lstat(path.join(exe.installation, 'data')).catch(error => { if (error.code === 'ENOENT') return null; throw error }), 'executable_changed')
    for (const input of exe.inputs) requireValue((await realpath(input.path)).toLowerCase() === input.path.toLowerCase() && sha(await readFile(input.path)) === input.sha256, 'executable_changed')
  }
  return {
    client: 'vscode', label: 'VS Code Local', configurationHome: sessionHome, executable: exe,
    entry: setup => readVSCodeSession(sessionHome, setup), matches: matchesVSCodeEntry,
    installPreview: setup => `Connector-owned VS Code Local profile only: ${vscodePaths(sessionHome, setup).root}. Normal profiles/extensions/workspaces are not edited. Native MCP startup is manual; connectivity stays unverified. Runtime-generated IDE files are preserved on disconnect.`,
    manualInstructions: vscodeInstructions,
    async install(setup) { await integrity(); return installVSCodeSession(sessionHome, setup) },
    async remove(setup, hash) {
      const files = vscodePaths(sessionHome, setup)
      await readVSCodeSession(sessionHome, setup)
      await settleVSCodeRun(files.process, files.user, runtime)
      await removeVSCodeSession(sessionHome, setup, hash)
    },
    async verify() { return vscodeVerification() },
    async launch(setup, token, signal) {
      requireValue(TOKEN.test(token), 'token_invalid')
      const files = vscodePaths(sessionHome, setup)
      requireValue(await readVSCodeSession(sessionHome, setup), 'configuration_changed')
      requireValue((await readVSCodeFile(files.settings))?.equals(vscodePayloads(setup).settings), 'configuration_changed')
      // An isolated extensions directory is not permission to launch newly installed extensions.
      requireValue((await readdir(files.extensions)).every(name => ['extensions.json', '.obsolete'].includes(name)), 'configuration_changed')
      for (const [name, expected] of [['extensions.json', '[]'], ['.obsolete', '{}']]) {
        const content = await readVSCodeFile(path.join(files.extensions, name))
        try { requireValue(!content || JSON.stringify(JSON.parse(content.toString('utf8'))) === expected, 'configuration_changed') }
        catch { throw new ConnectorError('configuration_changed') }
      }
      await integrity()
      const env: NodeJS.ProcessEnv = { ...vscodeEnvironment(sessionHome, setup, source), [setup.envVar]: token }; token = ''
      try { await launchVSCode(exe.path, vscodeLaunchArgs(sessionHome, setup), env, files.user, files.process, signal, runtime) }
      finally { delete env[setup.envVar] }
    },
  }
}

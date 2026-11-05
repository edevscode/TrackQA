import { readFile, realpath, lstat, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { capture, foreground } from '../process.ts'
import { ConnectorError, requireValue, TOKEN } from '../core.ts'
import type { Setup } from '../core.ts'
import { fingerprint } from './codex.ts'
import type { Executable } from './codex.ts'
import type { Adapter } from './adapter.ts'
import { geminiInstructions, geminiVerification } from './gemini-verify.ts'
import { editGeminiSettings, readGeminiSettings, parseGeminiSettings, geminiHeader, matchesGeminiEntry } from './gemini-config.ts'
export { geminiHeader, matchesGeminiEntry } from './gemini-config.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type Json = Record<string, unknown>
const object = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
export type GeminiCapabilities = { nativeAddPreservesUnrelated: boolean; nativeRemovePreservesUnrelated: boolean; generatedHttpEntry: true; literalHeader: true; rawEditorPreservesUnrelated: true; rawEditorRemoval: true }
export type GeminiExecutable = Executable & { nodePath: string; nodeHash: string; packageFile: string; packageHash: string; capabilities?: GeminiCapabilities }
export type Run = typeof capture

export function trustedGeminiLocation(file: string, home = os.homedir(), platform = process.platform, cwd = process.cwd()) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(file)) return false
  const normalized = paths.resolve(file).toLowerCase()
  const inside = (root: string) => normalized.startsWith(paths.resolve(root).toLowerCase() + paths.sep)
  const workspace = paths.resolve(cwd).toLowerCase(), relative = paths.relative(workspace, normalized)
  const inWorkspace = relative === '' || (relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  if (inWorkspace && workspace !== paths.resolve(home).toLowerCase()) return false
  const roots = platform === 'win32' ? [paths.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', '@google', 'gemini-cli'),
    paths.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node_modules', '@google', 'gemini-cli')]
    : ['/usr/local/lib/node_modules/@google/gemini-cli', '/usr/lib/node_modules/@google/gemini-cli']
  return roots.some(root => inside(root)) && paths.basename(file).toLowerCase().endsWith('.js')
}

export async function checkGeminiInstallation(file: string): Promise<GeminiExecutable> {
  requireValue(trustedGeminiLocation(file), 'executable_untrusted')
  const canonical = await realpath(file)
  requireValue(path.resolve(canonical).toLowerCase() === path.resolve(file).toLowerCase() && trustedGeminiLocation(canonical), 'executable_untrusted')
  let root = path.dirname(canonical), packageFile = ''
  // The package metadata must identify this exact executable as its gemini bin.
  for (let i = 0; i < 4; i++, root = path.dirname(root)) {
    const candidate = path.join(root, 'package.json')
    try { if (JSON.parse(await readFile(candidate, 'utf8')).name === '@google/gemini-cli') { packageFile = candidate; break } } catch { /* Keep looking within the allowed root. */ }
  }
  requireValue(packageFile, 'client_unsupported')
  const bytes = await readFile(packageFile), metadata = JSON.parse(bytes.toString('utf8'))
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.gemini
  requireValue(typeof bin === 'string' && path.resolve(path.dirname(packageFile), bin).toLowerCase() === canonical.toLowerCase()
    && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version), 'client_unsupported')
  const nodePath = await realpath(process.execPath)
  return { path: canonical, sha256: sha(await readFile(canonical)), version: metadata.version, nodePath,
    nodeHash: sha(await readFile(nodePath)), packageFile, packageHash: sha(bytes), appServer: false, foregroundMode: 'direct' }
}

const networkVariables = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_SYSTEM_CA'] as const
export function inheritGeminiNetworkEnvironment(child: NodeJS.ProcessEnv, source: NodeJS.ProcessEnv) {
  const env = { ...child }
  for (const key of networkVariables) {
    const configured = Object.keys(env).some(name => process.platform === 'win32' ? name.toLowerCase() === key.toLowerCase() : name === key)
    if (!configured && Object.hasOwn(source, key) && source[key] !== undefined) env[key] = source[key]
  }
  return env
}
export function geminiEnvironment(home: string, source: NodeJS.ProcessEnv = process.env, interactive = false) {
  const env: NodeJS.ProcessEnv = { GEMINI_CLI_HOME: home, NO_COLOR: '1', GEMINI_TELEMETRY_ENABLED: 'false', GEMINI_TELEMETRY_TRACES_ENABLED: 'false' }
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL']) if (source[key]) env[key] = source[key]
  // Preserve administrator policy overrides, but never ambient MCP tokens,
  // NODE_OPTIONS/preloads, Supabase credentials or editor attachment variables.
  for (const key of ['GEMINI_CLI_SYSTEM_SETTINGS_PATH', 'GEMINI_CLI_SYSTEM_DEFAULTS_PATH']) if (source[key]) env[key] = source[key]
  if (interactive) for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS']) if (source[key]) env[key] = source[key]
  // Proxy URLs may contain credentials. Keep them only in the child environment;
  // never log/serialize them or relax TLS verification to accommodate a proxy.
  return inheritGeminiNetworkEnvironment(env, source)
}
async function assertIntegrity(exe: GeminiExecutable) {
  for (const [file, hash] of [[exe.path, exe.sha256], [exe.nodePath, exe.nodeHash], [exe.packageFile, exe.packageHash]]) {
    requireValue(await realpath(file) === file && sha(await readFile(file)) === hash, 'executable_changed')
  }
}
async function invoke(exe: GeminiExecutable, args: string[], env: NodeJS.ProcessEnv, run: Run, cwd?: string) {
  await assertIntegrity(exe)
  // Execute the real npm package bin with the existing Node runtime. Never run
  // a .cmd/.ps1 wrapper through a shell or confuse agy.exe with Gemini CLI.
  return run(exe.nodePath, [exe.path, ...args], env, undefined, cwd)
}
async function settings(home: string): Promise<Json> {
  return readGeminiSettings(home)
}
async function readSettingsFile(file: string): Promise<Json> {
  try {
    const info = await lstat(file)
    requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 1_048_576, 'configuration_unreadable')
    const value: unknown = parseGeminiSettings(await readFile(file))
    requireValue(object(value) && (value.mcpServers === undefined || object(value.mcpServers)), 'configuration_unreadable')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new ConnectorError('configuration_unreadable') }
}
// Gemini documents auto-update as enabled by default. Do not let launching the
// user's client implicitly upgrade it. No preferences are changed here. Be
// conservative about workspace/system overrides rather than guessing precedence.
export async function assertNoAutoUpdate(home: string, source: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const user = await settings(home)
  requireValue(object(user.general) && user.general.enableAutoUpdate === false, 'gemini_auto_update_enabled')
  const system = await readSettingsFile(source.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? 'C:\\ProgramData\\gemini-cli\\settings.json')
  const layers = [system]
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    layers.push(await settings(dir))
    if (path.dirname(dir) === dir) break
  }
  for (const layer of layers) if (object(layer.general) && layer.general.enableAutoUpdate !== undefined) {
    requireValue(layer.general.enableAutoUpdate === false, 'gemini_auto_update_enabled')
  }
}
const servers = (value: Json) => (value.mcpServers ?? {}) as Json
export function geminiAddArgs(setup: Setup) {
  return ['mcp', 'add', '--scope', 'user', '--transport', 'http', '--header', `Authorization: ${geminiHeader(setup)}`, setup.serverName, setup.endpoint]
}
export const geminiRemoveArgs = (name: string) => ['mcp', 'remove', '--scope', 'user', name]
function withoutEntry(value: Json, name: string) {
  const rest = { ...servers(value) }; delete rest[name]
  const base = { ...value }; delete base.mcpServers
  return { ...base, ...(Object.keys(rest).length ? { mcpServers: rest } : {}) }
}

// Native behavior and raw-editor safety are measured independently. Native
// mutation remains confined to this disposable home even if it appears safe.
export async function probeGemini(exe: GeminiExecutable, run: Run = capture): Promise<GeminiCapabilities> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trackqa-gemini-probe-'))
  const workspace = path.join(root, 'workspace')
  try {
    await mkdir(path.join(root, '.gemini')); await mkdir(workspace)
    const original = { general: { enableAutoUpdate: false }, ui: { theme: 'Default' }, mcpServers: { unrelated: { httpUrl: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer ${UNRELATED_TOKEN}' } } } }
    await writeFile(path.join(root, '.gemini', 'settings.json'), JSON.stringify(original))
    // Nonexistent overrides avoid loading real system settings without trying
    // to impersonate administrator-owned policy files in a user-writable temp.
    // The temporary user settings above explicitly disable auto-update.
    const empty = path.join(root, 'absent-system.json')
    const env = { ...geminiEnvironment(root), HOME: root, USERPROFILE: root, UNRELATED_TOKEN: 'compatibility-sentinel-not-a-credential', GEMINI_CLI_SYSTEM_SETTINGS_PATH: empty, GEMINI_CLI_SYSTEM_DEFAULTS_PATH: empty }
    const command = (args: string[]) => invoke(exe, args, env, run, workspace)
    const version = (await command(['--version'])).trim()
    requireValue(version === exe.version, 'client_unsupported')
    for (const [args, flags] of [[['mcp', 'add', '--help'], ['--scope', '--transport', '--header']], [['mcp', 'remove', '--help'], ['--scope']], [['mcp', 'list', '--help'], ['list']]] as [string[], string[]][]) {
      const help = await command(args); requireValue(flags.every(flag => help.includes(flag)), 'client_unsupported')
    }
    const setup: Setup = { projectId: '11111111-1111-4111-8111-111111111111', serverName: 'trackqa_compatibility_probe', envVar: 'TRACKQA_PROBE_TOKEN', endpoint: 'https://example.invalid/mcp' }
    await command(geminiAddArgs(setup))
    const installed = await settings(root)
    requireValue(matchesGeminiEntry(servers(installed)[setup.serverName], setup), 'client_unsupported')
    const nativeAddPreservesUnrelated = fingerprint(withoutEntry(installed, setup.serverName)) === fingerprint(original)
    await command(geminiRemoveArgs(setup.serverName))
    const removed = await settings(root)
    requireValue(!Object.hasOwn(servers(removed), setup.serverName), 'client_unsupported')
    const nativeRemovePreservesUnrelated = fingerprint(removed) === fingerprint(withoutEntry(installed, setup.serverName))
    const rawHome = path.join(root, 'raw-editor')
    await mkdir(path.join(rawHome, '.gemini'), { recursive: true })
    await writeFile(path.join(rawHome, '.gemini', 'settings.json'), JSON.stringify(original))
    const hash = await editGeminiSettings(rawHome, setup, 'install')
    const rawInstalled = await settings(rawHome)
    requireValue(matchesGeminiEntry(servers(rawInstalled)[setup.serverName], setup)
      && fingerprint(withoutEntry(rawInstalled, setup.serverName)) === fingerprint(original), 'installation_unconfirmed')
    await editGeminiSettings(rawHome, setup, 'remove', hash)
    requireValue(fingerprint(await settings(rawHome)) === fingerprint(original), 'removal_unconfirmed')
    return { nativeAddPreservesUnrelated, nativeRemovePreservesUnrelated, generatedHttpEntry: true, literalHeader: true, rawEditorPreservesUnrelated: true, rawEditorRemoval: true }
  } catch (error) { if (error instanceof ConnectorError && error.code === 'executable_changed') throw error; throw new ConnectorError('gemini_compatibility_unverified') }
  finally { await rm(root, { recursive: true, force: true }) }
}

export async function detectGemini(explicit?: string, source = process.env, run: Run = capture, inspect = checkGeminiInstallation) {
  const prefixes = [...new Set([...(source.PATH ?? '').split(path.delimiter), source.APPDATA ? path.join(source.APPDATA, 'npm') : '', path.join(source.ProgramFiles ?? 'C:\\Program Files', 'nodejs')])].filter(folder => path.isAbsolute(folder))
  const candidates = explicit ? [explicit] : prefixes.flatMap(folder => ['dist/index.js', 'bundle/gemini.js']
    .map(bin => path.join(folder, 'node_modules', '@google', 'gemini-cli', bin)))
  let incompatible = false
  for (const file of candidates) {
    let exe: GeminiExecutable
    try { exe = await inspect(file) } catch (error) {
      if (explicit) throw error instanceof ConnectorError ? error : new ConnectorError('executable_untrusted')
      if (error instanceof ConnectorError && error.code === 'client_unsupported') incompatible = true
      continue
    }
    try { return { ...exe, capabilities: await probeGemini(exe, run) } }
    catch (error) { if (explicit || (error instanceof ConnectorError && error.code === 'executable_changed')) throw error; incompatible = true }
  }
  throw new ConnectorError(incompatible ? 'gemini_compatibility_unverified' : 'client_not_found')
}

export function geminiAdapter(exe: GeminiExecutable, home: string, run: Run = capture, source = process.env, launchForeground = foreground): Adapter {
  // Retain the injected runner for the detection/probe API, never user writes.
  void run
  const entry = async (setup: Setup) => servers(await settings(home))[setup.serverName] ?? null
  return {
    client: 'gemini', label: 'Gemini', configurationHome: home, executable: exe, entry, matches: matchesGeminiEntry,
    installPreview: () => 'Scoped user settings JSON editor; private flushed temporary file and Windows replacement; no native add/remove on real settings',
    manualInstructions: geminiInstructions,
    async prepare() { await assertNoAutoUpdate(home, source) },
    async install(setup) {
      await assertIntegrity(exe)
      return (await editGeminiSettings(home, setup, 'install'))!
    },
    async remove(setup, hash) {
      await editGeminiSettings(home, setup, 'remove', hash)
    },
    async verify() { return geminiVerification() },
    async launch(setup, token, signal) {
      requireValue(TOKEN.test(token), 'token_invalid')
      await assertNoAutoUpdate(home, source)
      requireValue(matchesGeminiEntry(await entry(setup), setup), 'configuration_changed')
      await assertIntegrity(exe)
      const childEnv = { ...geminiEnvironment(home, source, true), [setup.envVar]: token }; token = ''
      try {
        const running = launchForeground(exe.nodePath, childEnv, signal, undefined, [exe.path])
        delete childEnv[setup.envVar]
        await running
      } finally { delete childEnv[setup.envVar] }
    },
  }
}

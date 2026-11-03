import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { requireValue, setupFor, UUID } from '../core.ts'
import type { Setup } from '../core.ts'
import { fingerprint } from './codex.ts'

export const vscodeEntry = (setup: Setup) => ({ type: 'http', url: setup.endpoint, headers: { Authorization: `Bearer \${env:${setup.envVar}}` } })
export const matchesVSCodeEntry = (value: unknown, setup: Setup) => fingerprint(value) === fingerprint(vscodeEntry(setup))
export function vscodePaths(home: string, setup: Setup) {
  requireValue(path.isAbsolute(home) && UUID.test(setup.projectId) && fingerprint(setup) === fingerprint(setupFor(setup.projectId, 'vscode')), 'configuration_location_untrusted')
  const root = path.join(home, setup.projectId), user = path.join(root, 'user-data')
  return { root, user, extensions: path.join(root, 'extensions'), home: path.join(root, 'home'),
    owner: path.join(root, 'owner.json'), process: path.join(root, 'process.json'),
    mcp: path.join(user, 'User', 'mcp.json'), settings: path.join(user, 'User', 'settings.json') }
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
export function vscodePayloads(setup: Setup) {
  return {
    owner: bytes({ owner: 'TrackQA Connect VS Code Local v1', projectId: setup.projectId, server: setup.serverName }),
    mcp: bytes({ servers: { [setup.serverName]: vscodeEntry(setup) } }),
    settings: bytes({ 'update.mode': 'none', 'extensions.autoUpdate': 'off', 'extensions.autoCheckUpdates': false,
      'telemetry.telemetryLevel': 'off', 'chat.editor.localAgent.enabled': true, 'chat.defaultToCopilotHarness': false,
      'chat.editor.preferCopilotHarness': false, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
      'window.title': 'TrackQA Local — ${activeEditorShort}' }),
  }
}
export async function safeVSCodeDirectory(dir: string, create = false) {
  const absolute = path.resolve(dir), root = path.parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (create) { try { await mkdir(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error } }
    const info = await lstat(current)
    requireValue(info.isDirectory() && !info.isSymbolicLink() && (await realpath(current)).toLowerCase() === current.toLowerCase(), 'configuration_location_untrusted')
  }
}
export async function readVSCodeFile(file: string): Promise<Buffer | null> {
  try {
    const info = await lstat(file)
    requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 16384
      && (await realpath(file)).toLowerCase() === path.resolve(file).toLowerCase(), 'configuration_changed')
    const handle = await open(file, 'r')
    try {
      const stat = await handle.stat()
      requireValue(stat.ino === info.ino && stat.dev === info.dev, 'configuration_changed')
      const content = await handle.readFile()
      requireValue(content.length <= 16384, 'configuration_changed')
      return content
    } finally { await handle.close() }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function writeVSCodeFile(file: string, content: Buffer) {
  const handle = await open(file, 'wx', 0o600)
  try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
}
async function owned(home: string, setup: Setup) {
  const files = vscodePaths(home, setup)
  try { await safeVSCodeDirectory(home); await safeVSCodeDirectory(files.root) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  requireValue((await readVSCodeFile(files.owner))?.equals(vscodePayloads(setup).owner), 'configuration_conflict')
  return files
}
export async function readVSCodeSession(home: string, setup: Setup) {
  const files = await owned(home, setup)
  if (!files) return null
  for (const dir of [files.user, path.dirname(files.mcp), files.extensions, files.home]) await safeVSCodeDirectory(dir)
  const content = await readVSCodeFile(files.mcp)
  if (!content) return null
  requireValue(content.equals(vscodePayloads(setup).mcp), 'configuration_changed')
  return vscodeEntry(setup)
}
export async function installVSCodeSession(home: string, setup: Setup) {
  const files = vscodePaths(home, setup), payload = vscodePayloads(setup)
  await safeVSCodeDirectory(home, true)
  try {
    await mkdir(files.root, { mode: 0o700 })
    await writeVSCodeFile(files.owner, payload.owner)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await owned(home, setup) }
  await safeVSCodeDirectory(files.root)
  requireValue(!await readVSCodeFile(files.process), 'vscode_process_unconfirmed')
  for (const file of [files.mcp, files.settings]) requireValue(!await readVSCodeFile(file), 'configuration_conflict')
  for (const dir of [files.user, path.dirname(files.mcp), files.extensions, files.home,
    path.join(files.home, 'AppData', 'Roaming'), path.join(files.home, 'AppData', 'Local'), path.join(files.home, 'Temp')]) await safeVSCodeDirectory(dir, true)
  await writeVSCodeFile(files.settings, payload.settings)
  await writeVSCodeFile(files.mcp, payload.mcp)
  return fingerprint(vscodeEntry(setup))
}
export async function removeVSCodeSession(home: string, setup: Setup, hash: string | null) {
  const files = await owned(home, setup)
  if (!files) return
  for (const dir of [files.user, path.dirname(files.mcp)]) await safeVSCodeDirectory(dir)
  requireValue(!await readVSCodeFile(files.process), 'vscode_process_unconfirmed')
  requireValue(hash === null || hash === fingerprint(vscodeEntry(setup)), 'configuration_changed')
  // Validate both before deleting either. Never recursively remove IDE state or user files.
  const payload = vscodePayloads(setup)
  for (const key of ['mcp', 'settings'] as const) {
    const content = await readVSCodeFile(files[key])
    requireValue(!content || content.equals(payload[key]), 'configuration_changed')
  }
  for (const key of ['mcp', 'settings'] as const) {
    if (await readVSCodeFile(files[key])) await unlink(files[key])
  }
  // Keep the ownership marker and runtime-generated profile data. They may include
  // user-created files; removing a connection does not authorize deleting them.
}

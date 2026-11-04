import { lstat, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireValue, setupFor, UUID } from '../core.ts'
import type { Setup } from '../core.ts'
import { fingerprint } from './codex.ts'
import { readVSCodeFile, safeVSCodeDirectory, writeVSCodeFile } from './vscode-session.ts'

export const freshCopilotHome = (base: string) => path.join(base, 'runs', randomUUID())
export function copilotRecoveryHome(base: string, home: string) {
  const relative = path.relative(base, home).split(path.sep)
  requireValue(path.isAbsolute(home) && (path.resolve(home) === path.resolve(base)
    || relative.length === 2 && relative[0] === 'runs' && UUID.test(relative[1])), 'configuration_home_mismatch')
  return home
}

export function copilotPaths(home: string, setup: Setup) {
  requireValue(path.isAbsolute(home) && UUID.test(setup.projectId)
    && fingerprint(setup) === fingerprint(setupFor(setup.projectId, 'vscode-copilot')), 'configuration_location_untrusted')
  const root = path.join(home, setup.projectId), user = path.join(root, 'user-data'), isolatedHome = path.join(root, 'home')
  return { root, user, home: isolatedHome, extensions: path.join(root, 'extensions'), temp: path.join(isolatedHome, 'Temp'),
    copilot: path.join(root, 'copilot'), shared: path.join(root, 'shared-data'), owner: path.join(root, 'owner.json'),
    process: path.join(root, 'process.json'), launched: path.join(root, 'launch.json'), settings: path.join(user, 'User', 'settings.json'),
    localMcp: path.join(user, 'User', 'mcp.json'), mcp: path.join(root, 'copilot', 'mcp-config.json') }
}
export const copilotEntry = (setup: Setup) => ({ type: 'http', url: setup.endpoint,
  headers: { Authorization: `Bearer \${${setup.envVar}}` } })
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
export type CopilotConfigurationMode = 'session' | 'token-free'
export function copilotPayloads(setup: Setup, mode: CopilotConfigurationMode = 'session') {
  requireValue(['session', 'token-free'].includes(mode), 'configuration_conflict')
  return {
    owner: bytes({ owner: 'TrackQA Connect VS Code Copilot client-managed v1', client: 'vscode-copilot', projectId: setup.projectId, mode }),
    mcp: bytes({ mcpServers: mode === 'token-free' ? {} : { [setup.serverName]: copilotEntry(setup) } }),
    settings: bytes({ 'update.mode': 'none', 'extensions.autoUpdate': 'off', 'extensions.autoCheckUpdates': false,
      'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
      'window.title': 'TrackQA Copilot - ${activeEditorShort}' }),
  }
}
async function owned(home: string, setup: Setup, mode: CopilotConfigurationMode) {
  const files = copilotPaths(home, setup)
  try { await safeVSCodeDirectory(home); await safeVSCodeDirectory(files.root) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  requireValue((await readVSCodeFile(files.owner))?.equals(copilotPayloads(setup, mode).owner), 'configuration_conflict')
  return files
}
async function configuration(home: string, setup: Setup, mode: CopilotConfigurationMode) {
  const files = await owned(home, setup, mode)
  if (!files) return null
  for (const dir of [files.user, path.dirname(files.settings), files.extensions, files.home, files.temp, files.copilot, files.shared]) await safeVSCodeDirectory(dir)
  // A second registration source is unexpected, including a link or directory.
  requireValue(!await lstat(files.localMcp).catch(error => { if (error.code === 'ENOENT') return null; throw error }), 'configuration_conflict')
  return files
}
export async function readCopilotSession(home: string, setup: Setup, mode: CopilotConfigurationMode = 'session') {
  const files = await configuration(home, setup, mode)
  if (!files) return null
  const content = await readVSCodeFile(files.mcp)
  if (!content) return null
  requireValue(content.equals(copilotPayloads(setup, mode).mcp), 'configuration_changed')
  return mode === 'token-free' ? { mcpServers: {} } : copilotEntry(setup)
}
export async function installCopilotSession(home: string, setup: Setup, mode: CopilotConfigurationMode = 'session') {
  const files = copilotPaths(home, setup), payload = copilotPayloads(setup, mode)
  await safeVSCodeDirectory(home, true)
  try { await mkdir(files.root, { mode: 0o700 }); await writeVSCodeFile(files.owner, payload.owner) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await owned(home, setup, mode) }
  await safeVSCodeDirectory(files.root)
  requireValue(!await readVSCodeFile(files.process), 'copilot_process_unconfirmed')
  requireValue(!await readVSCodeFile(files.launched), 'configuration_conflict')
  for (const file of [files.settings, files.mcp, files.localMcp]) {
    requireValue(!await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error }), 'configuration_conflict')
  }
  for (const dir of [files.user, path.dirname(files.settings), files.extensions, files.home, files.temp, files.copilot, files.shared,
    path.join(files.home, 'AppData', 'Roaming'), path.join(files.home, 'AppData', 'Local')]) await safeVSCodeDirectory(dir, true)
  await writeVSCodeFile(files.settings, payload.settings)
  await writeVSCodeFile(files.mcp, payload.mcp)
  return fingerprint(mode === 'token-free' ? { mcpServers: {} } : copilotEntry(setup))
}
export async function removeCopilotSession(home: string, setup: Setup, hash: string | null, mode: CopilotConfigurationMode = 'session') {
  const files = await configuration(home, setup, mode)
  if (!files) return
  // Offline foundation cannot establish that a recorded runtime has stopped.
  // Never retire its evidence based on editor exit or an empty PID list alone.
  requireValue(!await readVSCodeFile(files.process), 'copilot_process_unconfirmed')
  requireValue(hash === null || hash === fingerprint(mode === 'token-free' ? { mcpServers: {} } : copilotEntry(setup)), 'configuration_changed')
  await removeOwnedCopilotConfiguration(files.mcp, copilotPayloads(setup, mode).mcp)
  // Preserve the owner marker, runtime data and any unexpected files. No tree deletion.
}
// Both validators establish ownership first. Keep removal identical for hosted
// sessions and the loopback test fixture, without accepting a different schema.
export async function removeOwnedCopilotConfiguration(file: string, expected: Buffer) {
  const content = await readVSCodeFile(file)
  requireValue(!content || content.equals(expected), 'configuration_changed')
  if (content) await unlink(file)
}

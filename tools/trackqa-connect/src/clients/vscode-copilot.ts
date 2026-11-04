import path from 'node:path'
import { ConnectorError } from '../core.ts'
import type { Setup } from '../core.ts'
import type { Adapter } from './adapter.ts'
import type { VSCodeExecutable } from './vscode.ts'
import { fingerprint } from './codex.ts'
import { copilotEntry, copilotPaths, installCopilotSession, readCopilotSession, removeCopilotSession } from './vscode-copilot-session.ts'
import { startCopilotSession } from './vscode-copilot-lifecycle.ts'

export function copilotEnvironment(home: string, setup: Setup, source: NodeJS.ProcessEnv = process.env) {
  const files = copilotPaths(home, setup), clean: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'WINDIR', 'COMSPEC', 'TERM', 'COLORTERM', 'LANG', 'LC_ALL',
    'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_SYSTEM_CA', 'NODE_EXTRA_CA_CERTS']) {
    if (source[key] !== undefined) clean[key] = source[key]
  }
  return { ...clean, HOME: files.home, USERPROFILE: files.home, APPDATA: path.join(files.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(files.home, 'AppData', 'Local'), TEMP: files.temp, TMP: files.temp,
    COPILOT_HOME: files.copilot, VSCODE_DISABLE_TELEMETRY: '1' }
}
export function copilotLaunchArgs(home: string, setup: Setup) {
  const files = copilotPaths(home, setup)
  return ['--new-window', '--user-data-dir', files.user, '--extensions-dir', files.extensions, '--shared-data-dir', files.shared,
    '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--sync', 'off',
    '--use-inmemory-secretstorage', '--log', 'warning']
}
const unavailable = () => { throw new ConnectorError('copilot_runtime_unverified') }
export function vscodeCopilotAdapter(exe: VSCodeExecutable, home: string, controls?: {
  requestDisconnect: (signal: AbortSignal) => Promise<void>; report: (message: string) => void
}): Adapter {
  let launcherStatus = 'not observed'
  return {
    client: 'vscode-copilot', label: 'VS Code Copilot', configurationHome: home, executable: exe,
    entry: setup => readCopilotSession(home, setup), matches: (value, setup) => fingerprint(value) === fingerprint(copilotEntry(setup)),
    installPreview: setup => `Private portable MCP configuration: ${copilotPaths(home, setup).mcp}. Session-only; native acceptance pending.`,
    prepare: async () => unavailable(),
    install: setup => installCopilotSession(home, setup),
    remove: async (setup, hash) => {
      try { await removeCopilotSession(home, setup, hash) }
      finally { controls?.report(`Editor launcher: ${launcherStatus}. Copilot runtime termination: UNVERIFIED. Use File > Exit in only TrackQA Copilot to exit normally. Runtime profile data is preserved.`) }
    },
    manualInstructions: setup => `In only TrackQA Copilot, use native Copilot MCP controls to start ${setup.serverName} and inspect its tools. GitHub/model sign-in is separate. Stop on unexpected permissions. No automatic tool approval. Keep the CLI open; type disconnect here to revoke access. Configuration and editor startup do not prove connectivity.`,
    verify: async () => {
      unavailable()
      return { authorized: null, verified: false, code: 'manual_verification_required' }
    },
    launch: async (setup, token, signal) => {
      unavailable() // Remains blocked until separately approved synthetic acceptance.
      if (!controls) throw new ConnectorError('usage')
      const session = await startCopilotSession(exe, home, setup, { credential: token, signal })
      token = ''
      try { await session.waitForDisconnect(controls.requestDisconnect, signal) }
      finally { launcherStatus = session.launcherStatus() }
    },
  }
}

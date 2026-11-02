import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { realpath } from 'node:fs/promises'
import { publicKey, withOwner } from './auth.ts'
import { codexAdapter, detectCodex } from './clients/codex.ts'
import { ConnectorError, display, parseArgs, requireValue } from './core.ts'
import { Store } from './state.ts'
import { connect, disconnect, status } from './workflow.ts'
import type { UI } from './workflow.ts'

export const help = `TrackQA Connect - local Phase 1 prototype (not published)
Usage from the TrackQA repository:
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client codex
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client codex
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client codex
Optional: --project <project UUID> --codex-path <trusted absolute native executable>
Only the Codex adapter is implemented in Phase 1. No client is preferred or selected by default.
Connect requires an interactive terminal and Google Owner authorization. No token is saved.
Status is local-only: it does not authorize or test a live MCP connection.
Disconnect may require fresh Google Owner sign-in. Never pass credentials as arguments.`

export async function locations(env: NodeJS.ProcessEnv = process.env) {
  const codexHome = env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
  requireValue(path.isAbsolute(codexHome), 'configuration_location_untrusted')
  const canonical = await realpath(codexHome).catch(() => path.resolve(codexHome))
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const under = (target: string, base: string) => target.toLowerCase() === base.toLowerCase() || target.toLowerCase().startsWith(path.resolve(base).toLowerCase() + path.sep)
  requireValue(!under(canonical, process.cwd()) && !under(canonical, repo), 'configuration_location_untrusted')
  const data = process.platform === 'win32' ? env.LOCALAPPDATA : env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state')
  requireValue(data && path.isAbsolute(data) && !under(data, repo) && !under(data, process.cwd()), 'recovery_unavailable')
  return { codexHome: canonical, store: new Store(path.join(data, 'TrackQA-Connect')) }
}
const codes = new Set(`usage client_unsupported client_foreground_unsupported client_not_found executable_untrusted executable_changed public_key_required authentication_failed callback_port_in_use callback_unavailable callback_timeout callback_rejected oauth_denied oauth_failed browser_open_failed interrupted identity_unverified profile_required mfa_unsupported owner_required no_eligible_owner_projects project_unavailable project_selection_unavailable request_failed response_invalid response_limit signout_unconfirmed configuration_unreadable configuration_conflict configuration_changed configuration_home_mismatch configuration_location_untrusted installation_unconfirmed removal_unconfirmed recovery_invalid recovery_unavailable existing_connection_recover_first connector_busy_or_stale_lock enablement_unconfirmed issuance_unconfirmed token_invalid cleanup_unconfirmed no_managed_connections client_command_failed client_command_timeout client_response_limit client_launch_failed client_exit_failed verification_initialization_failed verification_discovery_failed verification_connection_status_failed verification_project_scope_failed`.split(' '))
export function safeCode(error: unknown) {
  if (error instanceof ConnectorError && codes.has(error.code)) return error.code
  if (error instanceof Error && error.message === 'connector_busy_or_stale_lock') return error.message
  return 'operation_failed'
}
export async function main(args = process.argv.slice(2)) {
  // SDK diagnostics must never leak credential-bearing error objects. Only
  // our fixed messages go to stdout. The foreground client owns its terminal.
  const previousConsole = { ...console }
  for (const name of ['log', 'warn', 'error', 'debug', 'info'] as const) console[name] = () => {}
  let prompt: ReturnType<typeof createInterface> | undefined
  let unlock: (() => Promise<void>) | undefined
  const stop = new AbortController()
  const interrupt = () => stop.abort()
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  try {
    const options = parseArgs(args)
    if (options.command === 'help') { process.stdout.write(help + '\n'); return }
    const paths = await locations()
    const ui: UI = {
      say(message) { process.stdout.write(message + '\n') },
      async confirm(message) {
        requireValue(process.stdin.isTTY && process.stdout.isTTY, 'usage')
        requireValue(!stop.signal.aborted, 'interrupted')
        prompt ??= createInterface({ input: process.stdin, output: process.stdout })
        return (await prompt.question(message + ' [y/N] ', { signal: stop.signal })).trim().toLowerCase() === 'y'
      },
      async choose(message, choices) {
        requireValue(process.stdin.isTTY && process.stdout.isTTY, 'usage')
        requireValue(!stop.signal.aborted, 'interrupted')
        ui.say(message + '\n' + choices.map((choice, index) => `${index + 1}. ${display(choice)}`).join('\n'))
        prompt ??= createInterface({ input: process.stdin, output: process.stdout })
        const input = (await prompt.question('Selection (no default): ', { signal: stop.signal })).trim()
        requireValue(/^[1-9][0-9]*$/.test(input) && Number(input) <= choices.length, 'usage')
        return Number(input) - 1
      },
    }
    if (!options.client) await ui.choose('Select a supported client', ['Codex CLI (Phase 1 adapter)'])
    const executable = await detectCodex(paths.codexHome, options.executable)
    const adapter = codexAdapter(executable, paths.codexHome)
    if (options.command === 'connect') requireValue(executable.foregroundMode !== 'unsupported', 'client_foreground_unsupported')
    ui.say(`Codex detected: ${executable.version}. Recovery metadata: ${display(paths.store.root)}`)
    if (options.command === 'connect') ui.say(`Foreground launch: ${executable.foregroundMode === 'no-daemon' ? '--no-daemon (supported by this executable; no shared background server)' : 'direct (no --no-daemon flag advertised; interactive startup is not preverified)'}.`)
    if (options.command === 'status') { await status(paths.store, adapter, ui, options.projectId); return }
    requireValue(process.platform === 'win32', 'client_unsupported')
    unlock = await paths.store.lock()
    const authenticate = async <T>(action: Parameters<typeof withOwner<T>>[1]) => {
      requireValue(!stop.signal.aborted, 'interrupted')
      ui.say('Complete Google sign-in in your system browser. No password or token will be requested in this terminal.')
      return withOwner({ key: await publicKey(), signal: stop.signal }, action)
    }
    if (options.command === 'connect') {
      if (!await ui.confirm('Continue with Google Owner sign-in?')) return
      await authenticate(owner => connect({ owner, adapter, store: paths.store, ui: {
        ...ui,
        // Close readline before handing stdin to the foreground TUI, otherwise
        // it may consume Codex keystrokes. Future prompts reopen it as needed.
        say(message) { if (message.startsWith('Launching Codex.')) { prompt?.close(); prompt = undefined } ui.say(message) },
      }, projectId: options.projectId, signal: stop.signal }))
    } else {
      await disconnect(paths.store, adapter, ui, async action => { await authenticate(action) }, options.projectId)
    }
  } catch (error) {
    process.exitCode = 1
    const code = stop.signal.aborted ? 'interrupted' : safeCode(error)
    process.stdout.write(`TrackQA connector stopped: ${code}. No credentials are included in this diagnostic.\n`)
    if (code === 'cleanup_unconfirmed' || code === 'interrupted') process.stdout.write('Run status and disconnect to inspect nonsecret recovery metadata. An Owner can revoke access in Project Settings > AI Integrations > Manage Connections. Do not assume remote access was removed.\n')
    if (code === 'configuration_changed') process.stdout.write('The client entry changed after installation. It was preserved. Review only that server entry before removing it manually.\n')
    if (code === 'client_foreground_unsupported') process.stdout.write('This executable supports MCP configuration but has no verified interactive foreground launch mode. Select an existing complete Codex CLI using --codex-path. No installation or interactive retry was attempted; status/disconnect remain available.\n')
    if (code === 'client_launch_failed' || code === 'client_exit_failed') process.stdout.write('Codex foreground startup or exit failed; MCP verification is separate from TUI availability. Review the client diagnostic above and the cleanup result. No automatic relaunch was attempted.\n')
    if (code === 'connector_busy_or_stale_lock') process.stdout.write('Another session may be running. Inspect connector.lock in the displayed recovery folder. Remove only that lock after independently confirming its recorded process has exited.\n')
  } finally {
    prompt?.close()
    try { await unlock?.() } catch { process.exitCode = 1; process.stdout.write('Recovery lock cleanup unconfirmed; inspect nonsecret connector.lock before another attempt.\n') }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    Object.assign(console, previousConsole)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

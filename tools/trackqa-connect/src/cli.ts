import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { realpath } from 'node:fs/promises'
import { publicKey, withOwner } from './auth.ts'
import { codexAdapter, detectCodex } from './clients/codex.ts'
import { geminiAdapter, detectGemini } from './clients/gemini.ts'
import { claudeAdapter, detectClaude } from './clients/claude.ts'
import { vscodeAdapter, detectVSCode } from './clients/vscode.ts'
import { adapterLabel } from './clients/adapter.ts'
import type { Client } from './core.ts'
import { ConnectorError, display, parseArgs, requireValue } from './core.ts'
import { Store } from './state.ts'
import { connect, disconnect, status } from './workflow.ts'
import type { UI } from './workflow.ts'

export const help = `TrackQA Connect - local Windows prototype (not published)
Usage from the TrackQA repository:
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client codex
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client codex
  node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client codex
Use --client gemini for Gemini CLI; connect/status/disconnect use the same flow.
Use --client claude for the local, native-unverified Claude Code adapter.
Use --client vscode for experimental, isolated VS Code Local harness sessions.
Optional: --project <project UUID> --codex-path <trusted absolute native executable>
Gemini optional: --gemini-path <installed @google/gemini-cli package bin .js>
Claude optional: --claude-path <trusted absolute native claude.exe>
VS Code optional: --vscode-path <trusted installed absolute Code.exe>; supported family 1.143.x.
Claude connect only: --claude-only excludes other MCP servers for this session (opt-in).
Windows Codex, Gemini, Claude Code and VS Code Local adapters are implemented. None is selected by default.
Connect requires an interactive terminal and Google Owner authorization. No token is saved.
Status is local-only: it does not authorize or test a live MCP connection.
Disconnect may require fresh Google Owner sign-in. Never pass credentials as arguments.`

export async function locations(env: NodeJS.ProcessEnv = process.env, client: Client = 'codex') {
  const codexHome = env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
  if (client === 'codex') requireValue(path.isAbsolute(codexHome), 'configuration_location_untrusted')
  const canonical = await realpath(codexHome).catch(() => path.resolve(codexHome))
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const under = (target: string, base: string) => target.toLowerCase() === base.toLowerCase() || target.toLowerCase().startsWith(path.resolve(base).toLowerCase() + path.sep)
  if (client === 'codex') requireValue(!under(canonical, process.cwd()) && !under(canonical, repo), 'configuration_location_untrusted')
  const data = process.platform === 'win32' ? env.LOCALAPPDATA : env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state')
  requireValue(data && path.isAbsolute(data) && !under(data, repo) && !under(data, process.cwd()), 'recovery_unavailable')
  const geminiHome = env.GEMINI_CLI_HOME ?? os.homedir()
  const geminiCanonical = await realpath(geminiHome).catch(() => path.resolve(geminiHome))
  if (client === 'gemini') {
    requireValue(path.isAbsolute(geminiHome) && !under(geminiCanonical, repo) && !under(geminiCanonical, process.cwd()), 'configuration_location_untrusted')
    const config = path.join(geminiCanonical, '.gemini')
    const resolved = await realpath(config).catch(() => config)
    requireValue(resolved.toLowerCase() === config.toLowerCase(), 'configuration_location_untrusted')
  }
  return { codexHome: canonical, geminiHome: geminiCanonical, claudeHome: path.join(data, 'TrackQA-Connect', 'claude-sessions'), vscodeHome: path.join(data, 'TrackQA-Connect', 'vscode-sessions'), store: new Store(path.join(data, 'TrackQA-Connect')) }
}
const codes = new Set(`usage configuration_busy configuration_write_failed configuration_write_uncertain gemini_auto_update_enabled gemini_compatibility_unverified client_unsupported client_foreground_unsupported client_not_found executable_untrusted executable_changed public_key_required authentication_failed callback_port_in_use callback_unavailable callback_timeout callback_rejected oauth_denied oauth_failed browser_open_failed interrupted identity_unverified profile_required mfa_unsupported owner_required no_eligible_owner_projects project_unavailable project_selection_unavailable request_failed response_invalid response_limit signout_unconfirmed configuration_unreadable configuration_conflict configuration_changed configuration_home_mismatch configuration_location_untrusted installation_unconfirmed removal_unconfirmed recovery_invalid recovery_unavailable existing_connection_recover_first connector_busy_or_stale_lock enablement_unconfirmed issuance_unconfirmed token_invalid cleanup_unconfirmed no_managed_connections client_command_failed client_command_timeout client_response_limit client_launch_failed client_exit_failed verification_initialization_failed verification_discovery_failed verification_connection_status_failed verification_project_scope_failed`.split(' '))
export function safeCode(error: unknown) {
  if (error instanceof ConnectorError && error.code === 'vscode_process_unconfirmed') return error.code
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
    const client = options.client ?? (['codex', 'gemini', 'claude', 'vscode'] as const)[await ui.choose('Select a supported client', ['Codex CLI', 'Gemini CLI', 'Claude Code (native validation pending)', 'VS Code Local (experimental; manual activation)'])]
    const paths = await locations(process.env, client)
    const adapter = client === 'vscode'
      ? vscodeAdapter(await detectVSCode(options.executable), paths.vscodeHome)
      : client === 'claude'
      ? claudeAdapter(await detectClaude(options.executable), paths.claudeHome, process.env, options.claudeOnly)
      : client === 'gemini'
      ? geminiAdapter(await detectGemini(options.executable), paths.geminiHome)
      : codexAdapter(await detectCodex(paths.codexHome, options.executable), paths.codexHome)
    const executable = adapter.executable
    const label = adapterLabel(adapter)
    if (options.command === 'connect') requireValue(executable.foregroundMode !== 'unsupported', 'client_foreground_unsupported')
    ui.say(`${label} detected: ${executable.version}. Recovery metadata: ${display(paths.store.root)}`)
    if (options.command === 'connect') ui.say(client === 'vscode'
      ? 'Isolated VS Code Local window; native MCP activation is manual. Close the entire isolated instance for cleanup. Do not use Copilot or provider harnesses. No model account authentication is automated.'
      : `Foreground launch: ${executable.foregroundMode === 'no-daemon' ? '--no-daemon (supported by this executable; no shared background server)' : 'direct (no --no-daemon flag advertised; interactive startup is not preverified)'}.`)
    if (options.command === 'status') { await status(paths.store, adapter, ui, options.projectId); return }
    requireValue(process.platform === 'win32', 'client_unsupported')
    if (options.command === 'connect') await adapter.prepare?.()
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
        say(message) { if (/^Launching (?:Codex|Gemini|Claude Code|VS Code Local)\./.test(message)) { prompt?.close(); prompt = undefined } ui.say(message) },
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
    if (code === 'vscode_process_unconfirmed') process.stdout.write('VS Code process termination is unconfirmed. Close only the TrackQA Local instance, then run disconnect --client vscode using the same project. Keep process.json and recovery metadata; do not delete them to bypass the check. New unrelated Code processes can also require a conservative refusal. No process was force-killed.\n')
    if (code === 'configuration_busy') process.stdout.write('Settings are locked by another writer or a stale .trackqa-settings.lock. Close other configuration writers. Remove only a stale lock after confirming its recorded helper PID has exited.\n')
    if (code === 'configuration_write_failed' || code === 'configuration_write_uncertain') process.stdout.write('Settings replacement failed or its outcome is uncertain. Do not retry automatically. Inspect settings.json and any .trackqa-settings-recovery-*.bak in the selected Gemini home; preserve recovery metadata and compare/merge before restoring anything.\n')
    if (code === 'client_not_found') process.stdout.write('Selected client was not found in supported installation locations. No installation was attempted. For Gemini supply the existing @google/gemini-cli bin with --gemini-path; agy.exe is not Gemini CLI.\n')
    if (code === 'client_not_found' && args.includes('claude')) process.stdout.write('Claude Code requires an independently installed native Windows claude.exe; npm shims and Desktop are not selected. Use --claude-path for an existing supported native installation. No login or installation was attempted.\n')
    if (code === 'gemini_compatibility_unverified') process.stdout.write('Gemini capability or isolated JSON editor checks failed. Native add/remove are never used on real settings. No Owner sign-in or token issuance was attempted.\n')
    if (code === 'gemini_auto_update_enabled') process.stdout.write('Disable general.enableAutoUpdate using Gemini settings before this connector launches it. Workspace/system overrides must not re-enable it. The connector did not change your preferences or upgrade the client.\n')
    if (code === 'client_foreground_unsupported') process.stdout.write('This executable supports MCP configuration but has no verified interactive foreground launch mode. Select an existing complete Codex CLI using --codex-path. No installation or interactive retry was attempted; status/disconnect remain available.\n')
    if (code === 'client_launch_failed' || code === 'client_exit_failed') process.stdout.write('Client foreground startup or exit failed; MCP verification is separate from TUI availability. Review the client diagnostic above and the cleanup result. No automatic relaunch was attempted.\n')
    if (code === 'connector_busy_or_stale_lock') process.stdout.write('Another session may be running. Inspect connector.lock in the displayed recovery folder. Remove only that lock after independently confirming its recorded process has exited.\n')
  } finally {
    prompt?.close()
    try { await unlock?.() } catch { process.exitCode = 1; process.stdout.write('Recovery lock cleanup unconfirmed; inspect nonsecret connector.lock before another attempt.\n') }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    Object.assign(console, previousConsole)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

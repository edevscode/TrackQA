// Deliberately separate from the production CLI and synthetic loopback entry.
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs'
import { publicKey, withOwner } from '../src/auth.ts'
import { locations } from '../src/cli.ts'
import { ConnectorError, requireValue } from '../src/core.ts'
import { detectVSCode } from '../src/clients/vscode.ts'
import { createFixtureScope } from '../src/testing/copilot-fixture-scope.ts'
import { checkCopilotAcceptanceLocal, copilotHostedRecoveryBase, recoverCopilotHostedAcceptance, runCopilotHostedAcceptance } from '../src/testing/copilot-hosted.ts'
import { copilotHostedPathBudget, freshHostedCopilotHome } from '../src/testing/copilot-hosted-paths.ts'
import { HostedAcceptanceTiming } from '../src/testing/copilot-hosted-timing.ts'

export function parseHostedArgs(args) {
  requireValue(args[0] === '--fixture-hosted-copilot', 'fixture_mode_required')
  if (args.length === 1) return { recover: false }
  if (args.length === 2 && args[1] === '--recover') return { recover: true }
  requireValue(args.length === 3 && args[1] === '--vscode-path' && path.isAbsolute(args[2]), 'fixture_mode_required')
  return { recover: false, executable: args[2] }
}
export async function main(args = process.argv.slice(2)) {
  const previousConsole = { ...console }
  for (const name of ['log', 'warn', 'error', 'info', 'debug']) console[name] = () => {}
  const say = message => process.stdout.write(message + '\n')
  let prompt, unlock, trace
  const timing = new HostedAcceptanceTiming({ emit(event) {
    const line = JSON.stringify(event) + '\n'
    if (trace !== undefined) { writeSync(trace, line); fsyncSync(trace) }
    process.stdout.write('Timing: ' + line)
  } })
  const sigint = () => timing.abort('sigint_received'), sigterm = () => timing.abort('sigterm_received')
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm)
  try {
    const options = parseHostedArgs(args)
    requireValue(process.platform === 'win32' && process.stdin.isTTY && process.stdout.isTTY, 'usage')
    const paths = await locations(process.env, 'vscode-copilot')
    const homeBase = options.recover ? await copilotHostedRecoveryBase(paths.store, paths.vscodeCopilotHome) : paths.store.root
    if (!options.recover) copilotHostedPathBudget(freshHostedCopilotHome(homeBase)) // Before detection, prompts, PKCE or hosted operations.
    await checkCopilotAcceptanceLocal(paths.store, options.recover)
    const exe = options.recover ? null : await detectVSCode(options.executable)
    unlock = await paths.store.lock()
    const tracePath = path.join(paths.store.root, `copilot-hosted-timing-${randomUUID()}.jsonl`)
    trace = openSync(tracePath, 'wx', 0o600)
    say(`Nonsecret timing journal: ${tracePath}. Preserve it with the acceptance report.`)
    prompt = createInterface({ input: process.stdin, output: process.stdout })
    const ui = { say, async confirm(message) {
      timing.check()
      return (await prompt.question(message + ' [y/N] ', { signal: timing.signal })).trim().toLowerCase() === 'y'
    }, async choose() { throw new ConnectorError('fixture_identity_mismatch') } }
    if (!await ui.confirm('Start Google Owner sign-in for this fixed-fixture acceptance preflight/recovery? No enablement or issuance is authorized by this answer.')) return
    say('Complete Google Owner sign-in manually in your system browser. Never share credentials or callback URLs.')
    const scope = createFixtureScope()
    await withOwner({ key: await publicKey(), fixtureScope: scope, signal: timing.signal }, async owner => {
      if (options.recover) await recoverCopilotHostedAcceptance({ owner, scope, store: paths.store, homeBase, ui })
      else await runCopilotHostedAcceptance({ owner, scope, store: paths.store, homeBase, exe, ui, timing,
        requestDisconnect: async signal => {
          say('Use only the Copilot harness. GitHub sign-in is separate and requires explicit approval. Tool discovery is not permission to execute unrelated tools. End the native session, then type disconnect here. No tool is approved automatically.')
          // Fixed observation commands record manual reports, not inferred native success.
          while (!signal.aborted) {
            const command = (await prompt.question('Type ready / mcp-ready to record observed readiness, or disconnect to revoke TrackQA access: ', { signal })).trim().toLowerCase()
            if (command === 'disconnect') return
            if (command === 'ready') timing.observeReadiness('copilot_ready')
            if (command === 'mcp-ready') timing.observeReadiness('mcp_running_five_tools')
          }
        },
      })
    })
    say('Owner local sign-out completed. No credential was persisted by this entry point.')
    timing.check()
  } catch (error) {
    process.exitCode = 1
    const classified = timing.classify(error)
    const code = classified instanceof ConnectorError && /^[a-z_]{1,80}$/.test(classified.code) ? classified.code : 'fixture_operation_failed'
    say(`Hosted acceptance stopped: ${code}. Preserve existing recovery evidence; no automatic retry.`)
  } finally {
    timing.dispose(); prompt?.close()
    try { await unlock?.() } catch { process.exitCode = 1; say('Connector lock removal unconfirmed. Preserve recovery evidence.') }
    process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm)
    if (trace !== undefined) try { closeSync(trace) } catch { process.exitCode = 1; say('Timing journal close unconfirmed. Preserve timing and recovery evidence.') }
    Object.assign(console, previousConsole)
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

// Manual native acceptance entry point. Automated tests import parseSyntheticArgs
// only; no editor starts unless this exact file is invoked explicitly.
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { detectVSCode } from '../src/clients/vscode.ts'
import { ConnectorError, requireValue } from '../src/core.ts'
import { createCopilotSyntheticFixture } from '../src/testing/copilot-synthetic.ts'

export function parseSyntheticArgs(args) {
  requireValue(args[0] === '--synthetic-loopback' && (args.length === 1
    || args.length === 3 && args[1] === '--vscode-path' && path.isAbsolute(args[2])), 'synthetic_mode_required')
  return { mode: 'loopback-synthetic', executable: args[2] }
}
export async function main(args = process.argv.slice(2)) {
  let fixture, session, prompt, failure
  const stop = new AbortController(), interrupt = () => stop.abort()
  const say = message => process.stdout.write(message + '\n')
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  try {
    const options = parseSyntheticArgs(args)
    requireValue(process.platform === 'win32' && process.stdin.isTTY && process.stdout.isTTY, 'usage')
    const exe = await detectVSCode(options.executable)
    fixture = await createCopilotSyntheticFixture({ mode: options.mode, report: say })
    say(`Loopback synthetic fixture only. Profile: ${fixture.root}. Server: ${fixture.name}.`)
    say('No TrackQA credentials or hosted access. GitHub sign-in requires separate explicit approval. No automatic tool approval.')
    session = await fixture.launch(exe, { signal: stop.signal })
    say('In only TrackQA Copilot, use the Copilot harness native controls to discover synthetic_status. Invoke it at most once when authorized. Do not use Local or unrelated tools.')
    say('End the Copilot session through native controls, then type disconnect here. Editor and agent termination are not supervised.')
    prompt = createInterface({ input: process.stdin, output: process.stdout })
    await session.waitForDisconnect(async signal => {
      while (!signal.aborted) if ((await prompt.question('Type disconnect to revoke the synthetic credential: ', { signal })).trim().toLowerCase() === 'disconnect') return
    }, stop.signal)
  } catch (error) {
    failure = true
    say(`Synthetic test stopped: ${error instanceof ConnectorError ? error.code : 'synthetic_operation_failed'}. No raw exception details retained.`)
  } finally {
    prompt?.close()
    if (fixture) {
      // Safety cleanup is mandatory on Disconnect, interruption and launch failure.
      // This is the actual shared workflow with a memory-only local Owner fixture.
      try { await fixture.disconnect({ say, confirm: async () => true, choose: async () => 0 }) }
      catch { failure = true; say(`Synthetic cleanup unconfirmed. Preserve recovery evidence under ${fixture.root}.`) }
      say(`Synthetic protocol and revocation result: ${JSON.stringify(fixture.status())}`)
      say(`Launcher exit: ${session?.launcherStatus() ?? 'not observed'}. Agent/runtime termination: UNVERIFIED. Use File > Exit in only TrackQA Copilot. Profile data is preserved.`)
      try { await fixture.close(); say('Owned loopback listener: closed.') }
      catch { failure = true; say('Owned listener cleanup: UNCONFIRMED. Preserve recovery evidence.') }
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    if (failure) process.exitCode = 1
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ConnectorError, requireValue, TOKEN } from '../core.ts'
import type { Setup } from '../core.ts'
import type { VSCodeExecutable } from './vscode.ts'
import { copilotEnvironment, copilotLaunchArgs } from './vscode-copilot.ts'
import { copilotPaths, copilotPayloads, readCopilotSession } from './vscode-copilot-session.ts'
import { readVSCodeFile, safeVSCodeDirectory, writeVSCodeFile } from './vscode-session.ts'

export type CopilotRuntime = { spawn: typeof spawn; verify: (exe: VSCodeExecutable) => Promise<void> }
async function verify(exe: VSCodeExecutable) {
  requireValue(!await lstat(path.join(exe.installation, 'data')).catch(e => { if (e.code === 'ENOENT') return null; throw e }), 'executable_untrusted')
  for (const input of [{ path: exe.path, sha256: exe.sha256 }, ...exe.inputs]) {
    requireValue(input.path.toLowerCase().startsWith(path.resolve(exe.installation).toLowerCase() + path.sep), 'executable_untrusted')
    await safeVSCodeDirectory(path.dirname(input.path))
    const stat = await lstat(input.path)
    requireValue(stat.isFile() && !stat.isSymbolicLink() && (await realpath(input.path)).toLowerCase() === input.path.toLowerCase()
      && createHash('sha256').update(await readFile(input.path)).digest('hex') === input.sha256, 'executable_changed')
  }
}
export const copilotRuntime: CopilotRuntime = { spawn, verify }
export async function startCopilotSession(exe: VSCodeExecutable, home: string, setup: Setup,
  options: { credential?: string; signal?: AbortSignal; source?: NodeJS.ProcessEnv; runtime?: CopilotRuntime } = {}) {
  const files = copilotPaths(home, setup)
  const mode = options.credential === undefined ? 'token-free' : 'session'
  requireValue(!options.signal?.aborted, 'interrupted')
  requireValue(options.credential === undefined || TOKEN.test(options.credential), 'token_invalid')
  requireValue(await readCopilotSession(home, setup, mode), 'configuration_changed')
  return startPreparedCopilotSession(exe, {
    files, settings: copilotPayloads(setup, mode).settings, args: copilotLaunchArgs(home, setup),
    env: copilotEnvironment(home, setup, options.source), envVar: setup.envVar,
  }, options)
}
// Shared process primitive, called only after the production or separate local
// test validator has verified configuration ownership and expected bytes.
export async function startPreparedCopilotSession(exe: VSCodeExecutable, profile: {
  files: ReturnType<typeof copilotPaths>; settings: Buffer; args: string[]; env: NodeJS.ProcessEnv; envVar: string
}, options: { credential?: string; signal?: AbortSignal; runtime?: CopilotRuntime } = {}) {
  const runtime = options.runtime ?? copilotRuntime, { files } = profile
  requireValue(!options.signal?.aborted, 'interrupted')
  requireValue((await readVSCodeFile(files.settings))?.equals(profile.settings)
    && !await readVSCodeFile(files.process), 'configuration_changed')
  requireValue((await readdir(files.extensions)).every(name => ['extensions.json', '.obsolete'].includes(name)), 'configuration_changed')
  for (const [name, expected] of [['extensions.json', '[]'], ['.obsolete', '{}']]) {
    const content = await readVSCodeFile(path.join(files.extensions, name))
    try { requireValue(!content || JSON.stringify(JSON.parse(content.toString('utf8'))) === expected, 'configuration_changed') }
    catch { throw new ConnectorError('configuration_changed') }
  }
  await runtime.verify(exe)
  // Exclusive single-use receipt: an old GUI may survive Disconnect. Never reuse
  // its environment/profile or remove its runtime data based on launcher exit.
  await writeVSCodeFile(files.launched, Buffer.from('{"owner":"TrackQA Copilot single-use launch v1"}\n'))
  const env: NodeJS.ProcessEnv = { ...profile.env }
  if (options.credential) env[profile.envVar] = options.credential
  let child: ReturnType<typeof spawn>
  try { child = runtime.spawn(exe.path, profile.args, { env, cwd: files.root, windowsHide: false, stdio: 'ignore' }) }
  catch { throw new ConnectorError('client_launch_failed') }
  finally { delete env[profile.envVar]; options.credential = undefined }
  let exited = false, failure: ConnectorError | undefined
  let complete!: () => void
  const stopped = new Promise<void>(resolve => { complete = resolve })
  child.once('error', () => { failure = new ConnectorError('client_launch_failed'); complete() })
  child.once('exit', code => { exited = true; if (code !== 0) failure = new ConnectorError('client_exit_failed'); complete() })
  return {
    launcherStatus: () => exited ? 'exit-observed' as const : 'unconfirmed' as const,
    async waitForDisconnect(request: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal) {
      const prompt = new AbortController()
      let interrupted!: () => void
      const interruption = new Promise<void>(resolve => { interrupted = resolve })
      const abort = () => { interrupted() }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      try {
        await Promise.race([stopped, interruption, Promise.resolve().then(() => request(prompt.signal))])
        requireValue(!signal?.aborted, 'interrupted')
        if (failure) throw failure
      } finally {
        prompt.abort(); signal?.removeEventListener('abort', abort)
        // No descendant discovery, ownership adoption, shutdown RPC or kill.
        child.unref()
      }
    },
  }
}

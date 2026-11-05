import { createInterface } from 'node:readline'
import { spawnProcess, clientEnvironment } from '../process.ts'
import { ConnectorError, requireValue, TOKEN, tools } from '../core.ts'
import type { Setup } from '../core.ts'
export type Verification = { authorized: boolean | null; verified: boolean; code: string }

// Adapted from the existing Codex pilot app-server check. No model turn, code
// upload, synthetic project assumptions, finding submission or direct DB access.
export async function verifyCodex(executable: string, codexHome: string, setup: Setup, token: string,
  signal?: AbortSignal, spawnFn = spawnProcess, timeoutMs = 30_000): Promise<Verification> {
  requireValue(TOKEN.test(token), 'token_invalid')
  const env = { ...clientEnvironment(codexHome), [setup.envVar]: token }
  token = ''
  const table = `mcp_servers={${setup.serverName}={url="${setup.endpoint}",bearer_token_env_var="${setup.envVar}",startup_timeout_sec=15,tool_timeout_sec=10,enabled_tools=[${tools.map(name => `"${name}"`).join(',')}]}}`
  const child = spawnFn(executable, ['app-server', '--stdio', '-c', table, '-c', 'plugins={}', '-c', 'analytics.enabled=false'],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  delete env[setup.envVar]
  let sequence = 0, bytes = 0, stage = 'initialization', stopped = false, authorization: boolean | null = null
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const fail = () => {
    if (stopped) return
    stopped = true
    for (const promise of pending.values()) promise.reject(new ConnectorError('verification_failed'))
    pending.clear(); child.kill()
  }
  child.on('error', fail); child.on('exit', fail)
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on('error', fail)
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_048_576) fail() })
  const lines = createInterface({ input: child.stdout! })
  lines.on('error', fail)
  let startupError = false
  lines.on('line', (line: string) => {
    if (stopped) return
    try {
      const message = JSON.parse(line)
      if (message.method === 'mcpServer/startupStatus/updated' && message.params?.name === setup.serverName && message.params.error) startupError = true
      const promise = pending.get(message.id)
      if (!promise) return
      pending.delete(message.id)
      if (message.error) promise.reject(new ConnectorError('verification_failed'))
      else promise.resolve(message.result)
    } catch { fail() }
  })
  const timer = setTimeout(fail, timeoutMs)
  signal?.addEventListener('abort', fail, { once: true })
  const rpc = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    if (stopped || signal?.aborted) { reject(new ConnectorError('interrupted')); return }
    const id = ++sequence
    pending.set(id, { resolve, reject })
    child.stdin!.write(JSON.stringify({ id, method, params }) + '\n')
  })
  try {
    await rpc('initialize', { clientInfo: { name: 'trackqa_connect', version: '0.1.2' } })
    child.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
    const config = await rpc('config/read')
    const servers = config?.config?.mcp_servers
    requireValue(servers && Object.keys(servers).length === 1 && servers[setup.serverName]?.url === setup.endpoint, 'verification_failed')
    const thread = await rpc('thread/start', { cwd: process.cwd(), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' })
    requireValue(typeof thread?.thread?.id === 'string', 'verification_failed')
    const threadId = thread.thread.id
    stage = 'discovery'
    const result = await rpc('mcpServerStatus/list', { threadId, serverName: setup.serverName, detail: 'toolsAndAuthOnly', limit: 1 })
    const server = result?.data?.find((item: { name: string }) => item.name === setup.serverName)
    requireValue(server && !server.toolsError && !startupError, 'verification_failed')
    const names = Object.values(server.tools ?? {}).map((tool: any) => tool.name)
    requireValue(names.length === tools.length && tools.every(name => names.includes(name)), 'verification_failed')
    const call = async (tool: string) => {
      const result = await rpc('mcpServer/tool/call', { threadId, server: setup.serverName, tool, arguments: {} })
      requireValue(!result?.isError, 'verification_failed')
      return result.structuredContent ?? JSON.parse(result.content?.find((item: { type: string }) => item.type === 'text')?.text ?? 'null')
    }
    stage = 'connection_status'
    const status = await call('trackqa_connection_status')
    requireValue(status?.project_id === setup.projectId && status.database_connected === true && status.finding_submission === true && status.issue_writes_allowed === false, 'verification_failed')
    authorization = true
    stage = 'project_scope'
    const projects = await call('trackqa_list_projects')
    requireValue(projects?.projects?.length === 1 && projects.projects[0].id === setup.projectId, 'verification_failed')
    return { authorized: true, verified: true, code: 'verified' }
  } catch {
    return { authorized: authorization, verified: false, code: signal?.aborted ? 'interrupted' : `verification_${stage}_failed` }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', fail)
    lines.close(); child.stdin?.end()
    if (child.exitCode === null) {
      await new Promise<void>(resolve => {
        const force = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1500)
        child.once('exit', () => { clearTimeout(force); resolve() })
        child.kill()
      })
    }
  }
}

import { spawn as spawnProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { AUTH_URL as BASE, FIXTURE_PROJECT_ID } from './owner-auth.mjs'

export const CODEX_TOOLS = ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue']
const ENDPOINT = `${BASE}/functions/v1/trackqa-mcp`
const ISSUE = 'bf28539c-33c1-436a-a726-ada6843316ab'
const ENV_NAME = 'TRACKQA_MCP_TOKEN'

// No raw app-server diagnostics or responses leave this module.
function safeFailure(stage, detail = '') {
  const text = typeof detail === 'string' ? detail : ''
  const http = /\b(?:HTTP(?: status)?|status(?: code)?)[^\d]{0,12}(401|403|404|429|500|502|503|504)\b/i.exec(text)
    ?? /\b(401|403|404|429|500|502|503|504) (?:Unauthorized|Forbidden|Not Found|Too Many|Internal|Bad Gateway|Service|Gateway)/i.exec(text)
  const reason = /experimental.{0,60}capabil|capabil.{0,60}experimental/i.test(text) ? 'experimental_capability_required'
    : /decode|unexpected eof|stream.{0,30}closed|incomplete message/i.test(text) ? 'invalid_or_incomplete_response'
    : /protocol version|unsupported protocol/i.test(text) ? 'protocol_version'
    : /environment variable|env var/i.test(text) ? 'credential_environment'
    : /timed? ?out|timeout/i.test(text) ? 'timeout' : 'codex_mcp_failed'
  return { ok: false, stage, code: http ? 'http_error' : reason,
    ...(http ? { httpStatus: Number(http[1]) } : {}) }
}

// Uses the installed Codex MCP client through its official app-server protocol.
// No model turn, browser login, global config edit or token file is needed.
export async function checkCodexMcp({ executable, token, cwd, validateOnly = false, spawn = spawnProcess, timeoutMs = 45_000,
  endpoint = ENDPOINT, projectId = FIXTURE_PROJECT_ID, issueId = ISSUE, onlyListIssues = false }) {
  // A loopback override lets the existing offline HTTP harness exercise the real
  // Codex transport. The live endpoint remains fixed; arbitrary remotes fail.
  try {
    const url = new URL(endpoint)
    if (endpoint !== ENDPOINT && !(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.hash && !url.search)) return safeFailure('endpoint_configuration')
  } catch { return safeFailure('endpoint_configuration') }
  if (!validateOnly && !/^tqm_[0-9a-f]{64}$/.test(token ?? '')) return safeFailure('credential_input')
  const env = {}
  for (const name of ['SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATH', 'CODEX_HOME']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  if (!validateOnly) env[ENV_NAME] = token
  env.RUST_LOG = 'off'
  // Discovery below must succeed before any call. Avoid required=true: Codex
  // otherwise aborts thread creation before its detailed MCP status is readable.
  const table = `mcp_servers={trackqaPilot={url="${endpoint}",bearer_token_env_var="${ENV_NAME}",enabled=${!validateOnly},startup_timeout_sec=15,tool_timeout_sec=10,enabled_tools=[${CODEX_TOOLS.map(x => `"${x}"`).join(',')}]}}`
  let child, lines, timer, sequence = 0, stage = 'codex_startup', bytes = 0
  const pending = new Map()
  const checks = []
  let startupFailure
  const rejectAll = () => { for (const p of pending.values()) p.reject(new Error('Codex process stopped.')); pending.clear() }
  try {
    child = spawn(executable, ['app-server', '--stdio', '-c', table, '-c', 'plugins={}', '-c', 'analytics.enabled=false'],
      { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    delete env[ENV_NAME]
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', rejectAll)
    child.on('error', rejectAll); child.on('exit', rejectAll)
    child.stderr.on('data', () => {}) // Never echo diagnostics: they may include private context.
    timer = setTimeout(() => { for (const p of pending.values()) p.reject(new Error('timeout')); pending.clear(); child.kill() }, timeoutMs)
    lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      bytes += Buffer.byteLength(line)
      if (bytes > 1_048_576) { rejectAll(); return }
      let message
      try { message = JSON.parse(line) } catch { rejectAll(); return }
      if (message.method === 'mcpServer/startupStatus/updated' && message.params?.name === 'trackqaPilot' && message.params.error) {
        startupFailure = safeFailure('mcp_startup', message.params.error)
      }
      const p = pending.get(message.id)
      if (!p) return
      pending.delete(message.id)
      message.error ? p.reject(new Error(typeof message.error.message === 'string' ? message.error.message : '')) : p.resolve(message.result)
    })
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
    await rpc('initialize', { clientInfo: { name: 'trackqa_codex_pilot', version: '1' } })
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
    stage = 'isolated_configuration'
    const configuration = await rpc('config/read')
    const servers = configuration.config?.mcp_servers
    if (!servers || Object.keys(servers).length !== 1 || !servers.trackqaPilot || servers.trackqaPilot.url !== endpoint) throw new Error()
    if (validateOnly) return { ok: true, stage: 'local_configuration_validated', serverEnabled: false }
    stage = 'ephemeral_thread'
    const started = await rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' })
    const threadId = started.thread?.id
    if (typeof threadId !== 'string') throw new Error()
    stage = 'mcp_initialization_and_discovery'
    const inventory = await rpc('mcpServerStatus/list', { threadId, serverName: 'trackqaPilot', detail: 'toolsAndAuthOnly', limit: 1 })
    const server = inventory.data?.find(x => x.name === 'trackqaPilot')
    if (!server || server.toolsError) throw new Error(server?.toolsError ?? '')
    const names = Object.values(server.tools ?? {}).map(x => x.name)
    if (names.length !== 4 || !CODEX_TOOLS.every(x => names.includes(x))) throw new Error()
    checks.push({ check: 'codex_initialization_and_discovery', pass: true })
    const inputs = [{}, {}, { project_id: projectId, limit: onlyListIssues ? 1 : 2, offset: 0 }, { issue_id: issueId }]
    for (const index of onlyListIssues ? [2] : [0, 1, 2, 3]) {
      stage = CODEX_TOOLS[index]
      const result = await rpc('mcpServer/tool/call', { threadId, server: 'trackqaPilot', tool: stage, arguments: inputs[index] })
      if (result.isError) throw new Error()
      const data = result.structuredContent
        ?? JSON.parse(result.content?.find(x => x.type === 'text')?.text ?? 'null')
      const valid = index === 0 ? data?.project_id === projectId && data.database_connected === true
        && (data.read_only === true || (data.finding_submission === true && data.issue_writes_allowed === false))
        : index === 1 ? data?.projects?.length === 1 && data.projects[0].id === projectId && data.projects[0].key === 'MCPPILOT'
        : index === 2 ? data?.issues?.length === 1 && data.issues[0].id === issueId && data.issues[0].project_id === projectId && data.issues[0].issue_number === 1
        : data?.issue?.id === issueId && data.issue.project_id === projectId && data.issue.title === '[SYNTHETIC] MCP read-tool fixture'
      if (!valid) throw new Error()
      checks.push({ check: stage, pass: true })
    }
    return { ok: true, client: 'installed_codex_app_server', checks }
  } catch (error) { return { ...(startupFailure ?? safeFailure(stage, error?.message)), checks } }
  finally {
    clearTimeout(timer); delete env[ENV_NAME]; token = undefined
    lines?.close(); child?.stdin.end()
    if (child && child.exitCode === null) {
      await new Promise(resolve => {
        const force = setTimeout(() => { child.kill(); resolve() }, 3000)
        child.once('exit', () => { clearTimeout(force); resolve() })
      })
    }
  }
}

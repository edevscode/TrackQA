import type { McpConnection } from './database.types.ts'

export type McpClient = 'codex' | 'claude' | 'generic'
export type Terminal = 'powershell' | 'bash'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const connectionFields = 'id,project_id,user_id,approved_by,client_label,token_expires_at,created_at,updated_at,revoked_at' as const
export const mcpTools = [
  { name: 'trackqa_connection_status', description: 'Check the authorized connection and project.' },
  { name: 'trackqa_list_projects', description: 'Show the single approved project.' },
  { name: 'trackqa_list_issues', description: 'List issues in that project.' },
  { name: 'trackqa_get_issue', description: 'Read an issue in that project.' },
  { name: 'trackqa_submit_finding', description: 'Submit a potential bug for human QA/Owner review.' },
] as const
export const clientDocs = {
  codex: 'https://developers.openai.com/codex/mcp/',
  claude: 'https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson',
}

// These builders never accept a token. UUID-derived identifiers avoid project
// name/key injection and keep credentials for different projects independent.
export function mcpSetup(supabaseUrl: string, projectId: string) {
  let url: URL
  try { url = new URL(supabaseUrl) } catch { throw new Error('MCP endpoint configuration is unavailable.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.port || !uuid.test(projectId)) {
    throw new Error('MCP endpoint configuration is unavailable.')
  }
  const id = projectId.replaceAll('-', '').toLowerCase()
  return { endpoint: `${url.origin}/functions/v1/trackqa-mcp`, serverName: `trackqa_${id}`,
    envVar: `TRACKQA_MCP_${id.toUpperCase()}_TOKEN`, projectId: projectId.toLowerCase() }
}
export type McpSetup = ReturnType<typeof mcpSetup>

function verifySetup(setup: McpSetup) {
  try {
    const expected = mcpSetup(new URL(setup.endpoint).origin, setup.projectId)
    if (setup.endpoint === expected.endpoint && setup.serverName === expected.serverName && setup.envVar === expected.envVar) return
  } catch { /* Return only a fixed configuration error. */ }
  throw new Error('Client setup is unavailable.')
}

export function clientConfig(setup: McpSetup, client: McpClient): string | null {
  verifySetup(setup)
  if (!['codex', 'claude', 'generic'].includes(client)) throw new Error('Client setup is unavailable.')
  if (client === 'generic') return null // There is no universal client config schema.
  if (client === 'claude') return JSON.stringify({ mcpServers: { [setup.serverName]: {
    type: 'http', url: setup.endpoint, headers: { Authorization: 'Bearer ${' + setup.envVar + '}' },
  } } }, null, 2)
  return `[mcp_servers.${setup.serverName}]\nurl = ${JSON.stringify(setup.endpoint)}\nbearer_token_env_var = ${JSON.stringify(setup.envVar)}\nenabled_tools = [${mcpTools.map(tool => JSON.stringify(tool.name)).join(', ')}]`
}

export function clientLaunch(setup: McpSetup, client: Exclude<McpClient, 'generic'>, terminal: Terminal): string {
  verifySetup(setup)
  // Only fixed executable names and validated variable identifiers enter code.
  if (!/^TRACKQA_MCP_[0-9A-F]{32}_TOKEN$/.test(setup.envVar)
    || !['codex', 'claude'].includes(client) || !['powershell', 'bash'].includes(terminal)) {
    throw new Error('Client setup is unavailable.')
  }
  const variable = setup.envVar
  if (terminal === 'bash') return `(
  set +x
  trap 'unset ${variable}' EXIT
  if ! read -r -s -p 'TrackQA token (hidden): ' ${variable}; then exit 1; fi
  printf '\\n'
  if [[ ! "$${variable}" =~ ^tqm_[0-9a-f]{64}$ ]]; then printf 'Invalid TrackQA token format.\\n' >&2; exit 1; fi
  export ${variable}
  ${client}
)`
  return `& {
  $ErrorActionPreference = 'Stop'
  $secureToken = Read-Host 'TrackQA token (hidden)' -AsSecureString
  $tokenPointer = [IntPtr]::Zero
  try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:${variable} = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ($env:${variable} -notmatch '^tqm_[0-9a-f]{64}$') { throw 'Invalid TrackQA token format.' }
    ${client}
  } finally {
    Remove-Item Env:${variable} -ErrorAction SilentlyContinue
    if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    $secureToken.Dispose()
  }
}`
}

export function connectionStatus(connection: McpConnection, enabled: boolean, archived: boolean, memberPresent: boolean, now: number) {
  if (connection.revoked_at) return 'Revoked'
  const expires = Date.parse(connection.token_expires_at)
  if (!Number.isFinite(expires) || expires <= now) return 'Expired'
  if (!connection.user_id || !connection.approved_by || !memberPresent) return 'Unavailable'
  if (archived) return 'Project archived'
  if (!enabled) return 'Project disabled'
  return 'Ready to connect'
}

type IssueArguments = { p_project_id: string; p_user_id: string; p_client_label: string }
type IssueResult = { data: { connection_id: string; access_token: string }[] | null; error: unknown }
export type TokenReveal = { connectionId: string; token: string }
export function watchTokenReveal(
  clear: () => void,
  documentTarget: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>,
) {
  const hide = () => { if (documentTarget.hidden) clear() }
  const timer = windowTarget.setTimeout(clear, 120_000)
  documentTarget.addEventListener('visibilitychange', hide)
  windowTarget.addEventListener('pagehide', clear)
  return () => {
    windowTarget.clearTimeout(timer)
    documentTarget.removeEventListener('visibilitychange', hide)
    windowTarget.removeEventListener('pagehide', clear)
  }
}
const issuanceError = () => new Error('Token issuance could not be completed. Refresh connections and revoke any new entry before trying again.')

// The existing human-authenticated RPC remains authoritative. No retry, cache,
// persistence, diagnostics, or token-bearing return value is introduced here.
export async function issueConnectionToken(
  call: (args: IssueArguments) => PromiseLike<IssueResult>,
  scope: { projectId: string; userId: string; isOwner: boolean; enabled: boolean; archived: boolean; memberIds: readonly string[] },
  label: string,
  reveal: (value: TokenReveal) => boolean,
): Promise<{ connectionId: string; displayed: boolean }> {
  let rows: IssueResult['data'] = null
  try {
    if (!scope.isOwner || !scope.enabled || scope.archived || !uuid.test(scope.projectId)
      || !uuid.test(scope.userId) || !scope.memberIds.includes(scope.userId)
      || !label.trim() || label.trim().length > 120) throw issuanceError()
    const result = await call({ p_project_id: scope.projectId, p_user_id: scope.userId, p_client_label: label.trim() })
    rows = result.data
    if (result.error || !Array.isArray(rows) || rows.length !== 1 || !uuid.test(rows[0]?.connection_id)
      || !/^tqm_[0-9a-f]{64}$/.test(rows[0]?.access_token)) throw issuanceError()
    const connectionId = rows[0].connection_id
    const displayed = reveal({ connectionId, token: rows[0].access_token })
    return { connectionId, displayed }
  } catch { throw issuanceError() }
  finally {
    // Discard the SDK response's one-time secret after handing it to the local
    // reveal dialog. It must never enter connection metadata or a query cache.
    if (Array.isArray(rows)) for (const row of rows) if (row && typeof row === 'object') row.access_token = ''
  }
}

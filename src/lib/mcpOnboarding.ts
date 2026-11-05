import type { McpConnection } from './database.types.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const connectionFields = 'id,project_id,user_id,approved_by,client_label,token_expires_at,created_at,updated_at,revoked_at' as const
export const mcpTools = [
  { name: 'trackqa_connection_status', description: 'Check the authorized connection and project.' },
  { name: 'trackqa_list_projects', description: 'Show the single approved project.' },
  { name: 'trackqa_list_issues', description: 'List issues in that project.' },
  { name: 'trackqa_get_issue', description: 'Read an issue in that project.' },
  { name: 'trackqa_submit_finding', description: 'Submit a potential bug for human QA/Owner review.' },
] as const

// UUID-derived identifiers keep project configurations independent.
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

export function connectionStatus(connection: McpConnection, enabled: boolean, archived: boolean, memberPresent: boolean, now: number) {
  if (connection.revoked_at) return 'Revoked'
  const expires = Date.parse(connection.token_expires_at)
  if (!Number.isFinite(expires) || expires <= now) return 'Expired'
  if (!connection.user_id || !connection.approved_by || !memberPresent) return 'Unavailable'
  if (archived) return 'Project archived'
  if (!enabled) return 'Project disabled'
  return 'Ready to connect'
}

import * as z from 'zod'
import type { Authorize } from './access.ts'
import type { TokenResolver } from './token-resolver.ts'

// Exact output contract of 0033.resolve_mcp_connection. A successful row means
// the database has checked approval, expiry, revocation and live project state.
const resolvedConnection = z.array(z.object({
  connection_id: z.uuid(), user_id: z.uuid(), project_id: z.uuid(),
}).strict()).length(1)

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header || header.length > 128) return null
  // Scheme is case insensitive; token prefix/hex are case sensitive. Reject
  // comma-joined duplicate headers, extra credentials, tabs and other schemes.
  const match = /^([^ ]+) +(tqm_[0-9a-f]{64})$/.exec(header)
  return match && match[1].toLowerCase() === 'bearer' ? match[2] : null
}

// Share the existing parser without exposing the credential to the admission gate.
export function hasMcpBearerCredential(request: Request): boolean {
  return bearerToken(request) !== null
}

export function createBearerAuthorizer(resolveToken: TokenResolver, onVerified?: (hash: string) => void): Authorize {
  return async (request) => {
    const token = bearerToken(request)
    if (!token) return null
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      // No positive authorization cache: resolve again for every MCP request.
      const result = resolvedConnection.safeParse(await resolveToken(hash))
      if (!result.success) return null
      const row = result.data[0]
      onVerified?.(hash)
      return Object.freeze({
        connectionId: row.connection_id, userId: row.user_id, projectId: row.project_id,
        approved: true, isMember: true, mcpEnabled: true, projectArchived: false, revoked: false,
      })
    } catch {
      // Missing/revoked tokens, RPC failures and malformed results reveal no
      // database details or credential values to callers or logs.
      return null
    }
  }
}

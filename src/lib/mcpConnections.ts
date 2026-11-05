import type { McpConnection } from './database.types'

/** Active grants, not a claim that an AI client is currently connected. */
export function isActiveConnection(connection: McpConnection, now: number) {
  const expires = Date.parse(connection.token_expires_at)
  return connection.revoked_at === null && !!connection.user_id && !!connection.approved_by
    && Number.isFinite(expires) && expires > now
}

type ConnectionCheck = {
  data: { id: string; project_id: string; revoked_at: string | null } | null
  error: unknown
}

/** A successful mutation alone is not independent evidence of revocation. */
export async function verifyConnectionRevoked(
  lookup: () => PromiseLike<ConnectionCheck>, projectId: string, connectionId: string,
): Promise<boolean> {
  try {
    const { data, error } = await lookup()
    return !error && data?.id === connectionId && data.project_id === projectId
      && typeof data.revoked_at === 'string' && Number.isFinite(Date.parse(data.revoked_at))
  } catch { return false }
}

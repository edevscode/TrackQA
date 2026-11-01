import { createDatabaseRpc } from './database-rpc.ts'
import type { DatabaseOptions, DatabaseRpc } from './database-rpc.ts'
export { MAX_RESOLVER_RESPONSE_BYTES } from './database-rpc.ts'

export type TokenResolver = (tokenHash: string) => Promise<unknown>

export function tokenResolver(rpc: DatabaseRpc): TokenResolver {
  return async (hash) => {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null
    try { return await rpc('resolve_mcp_connection', { p_token_hash: hash }) }
    catch { return null }
  }
}

export function createDatabaseTokenResolver(options: DatabaseOptions): TokenResolver {
  return tokenResolver(createDatabaseRpc(options))
}

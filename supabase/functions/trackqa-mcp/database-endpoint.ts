import { createBearerAuthorizer } from './bearer-auth.ts'
import { createDatabaseDataAccess } from './database-data.ts'
import { createDatabaseRpc, DatabaseError } from './database-rpc.ts'
import type { DatabaseOptions } from './database-rpc.ts'
import { createEndpoint } from './handler.ts'
import { tokenResolver } from './token-resolver.ts'

export function createDatabaseEndpoint(options: DatabaseOptions & { allowedHostnames?: string[]; allowedOriginHostnames?: string[] }) {
  const rpc = createDatabaseRpc(options)
  const resolve = tokenResolver(rpc)
  return {
    async fetch(request: Request): Promise<Response> {
      // New private context for EACH request. The data factory is reachable only
      // after the bearer authorizer validates the resolver's identity row.
      // Never attach the hash to the identity, Request, tool args or responses.
      let verifiedHash: string | undefined
      const authorize = createBearerAuthorizer(resolve, (hash) => { verifiedHash = hash })
      return createEndpoint({
        authorize, dataSource: 'database',
        allowedHostnames: options.allowedHostnames, allowedOriginHostnames: options.allowedOriginHostnames,
        data: (access) => {
          if (!verifiedHash) throw new DatabaseError('scope')
          return createDatabaseDataAccess(rpc, verifiedHash, access, options.diagnose)
        },
      }).fetch(request)
    },
  }
}

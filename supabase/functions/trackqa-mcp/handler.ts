import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server'
import { denyAccess, permittedAccess } from './access.ts'
import type { Authorize, ConnectionAccess } from './access.ts'
import { createMockDataAccess } from './mock-data.ts'
import type { DataAccess } from './mock-data.ts'
import { createServer } from './tools.ts'

export const MAX_REQUEST_BYTES = 16_384

interface EndpointOptions {
  // Trusted in-process authorizer; the Edge entry point installs bearer auth.
  // The factory itself remains default-deny. No header-based mock identity.
  authorize?: Authorize
  data?: DataAccess | ((access: Readonly<ConnectionAccess>) => DataAccess)
  dataSource?: 'mock' | 'database'
  allowedHostnames?: string[]
  allowedOriginHostnames?: string[]
}

function failure(status: number, message: string): Response {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="trackqa-mcp"' } : {}) },
  })
}

export function createEndpoint(options: EndpointOptions = {}) {
  const authorize = options.authorize ?? denyAccess
  const hosts = [...(options.allowedHostnames ?? ['localhost', '127.0.0.1'])]
  const origins = [...(options.allowedOriginHostnames ?? [])]

  return {
    async fetch(request: Request): Promise<Response> {
      // The SDK parses Host as a URL; reject userinfo, paths, escapes and other
      // non-authority syntax before that parser can normalize them into a match.
      const host = request.headers.get('host')
      if (host && !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(host)) return failure(403, 'Invalid Host header.')
      const rejected = hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, origins)
      if (rejected) return rejected
      let identity
      try { identity = await authorize(request) }
      catch { return failure(503, 'Authorization unavailable.') }
      if (identity === null) return failure(401, 'Authentication required.')
      const access = permittedAccess(identity)
      if (!access) return failure(403, 'Connection unavailable.')

      // Each request captures its own validated immutable identity. No global
      // current-user variable, session map, or shared mutable server instance.
      const protocol = createMcpHandler(() => {
        if (options.dataSource === 'database' && !options.data) throw new Error('Data unavailable.')
        const data = typeof options.data === 'function' ? options.data(access) : options.data ?? createMockDataAccess()
        return createServer(access, data, options.dataSource)
      }, {
        legacy: 'stateless', maxRequestBodySize: MAX_REQUEST_BYTES,
        maxSubscriptions: 0, keepAliveMs: 0,
      })
      try {
        const response = await protocol.fetch(request)
        response.headers.set('Cache-Control', 'no-store')
        return response
      } catch {
        return failure(500, 'MCP request failed.')
      } finally {
        await protocol.close()
      }
    },
  }
}

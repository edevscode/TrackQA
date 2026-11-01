import { hasMcpBearerCredential } from './bearer-auth.ts'
import { hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server'

interface Endpoint { fetch(request: Request): Promise<Response> }
type Admission = () => Promise<unknown>
interface AdmissionOptions { allowedHostnames?: string[]; allowedOriginHostnames?: string[] }

function blocked(status: number): Response {
  return Response.json({ error: status === 429 ? 'Too many requests.' : 'Service temporarily unavailable.' }, {
    status, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
  })
}

export function withRequestAdmission(endpoint: Endpoint, admit: Admission, options: AdmissionOptions = {}): Endpoint {
  // Use the same SDK checks/defaults as the MCP handler before any database
  // work. The handler retains its own checks as a separate authorization boundary.
  const hosts = [...(options.allowedHostnames ?? ['localhost', '127.0.0.1'])]
  const origins = [...(options.allowedOriginHostnames ?? [])]
  return {
    async fetch(request: Request): Promise<Response> {
      const rejected = hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, origins)
      if (rejected) return rejected
      // Missing/malformed credentials are already rejected cheaply without DB
      // access. All potentially expensive lookups share one persistent budget,
      // including legitimate requests. Rotating tokens/IP headers cannot bypass it.
      if (hasMcpBearerCredential(request)) {
        let result: unknown
        try { result = await admit() } catch { return blocked(503) }
        if (!Array.isArray(result) || result.length !== 1) return blocked(503)
        const row = result[0]
        if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'allowed,retry_after_seconds') return blocked(503)
        if (row.allowed === false && row.retry_after_seconds === 1) return blocked(429)
        if (row.allowed !== true || row.retry_after_seconds !== 0) return blocked(503)
      }
      return endpoint.fetch(request)
    },
  }
}

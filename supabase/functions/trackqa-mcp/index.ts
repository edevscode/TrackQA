import { createDatabaseEndpoint } from './database-endpoint.ts'

// Resolver construction performs no network requests. Only a well-formed token
// can trigger server-only RPCs. Missing/invalid config fails closed.
const platformUrl = Deno.env.get('SUPABASE_URL')
const options = {
  supabaseUrl: platformUrl,
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  // Supabase's hosted relay uses this internal authority (also shown in its
  // official logging example). It is not authentication or an allowed Origin.
  // Never derive this allowlist from Forwarded/X-Forwarded-Host headers.
  allowedHostnames: platformUrl ? [new URL(platformUrl).hostname, 'edge-runtime.supabase.com'] : ['localhost', '127.0.0.1'],
  diagnose: (event: import('./database-rpc.ts').RpcDiagnostic) => console.warn('trackqa_mcp_database', event),
}
const endpoint = createDatabaseEndpoint(options)
// Supervised pilot: the endpoint itself enforces Host/Origin and bearer/RPC
// authorization. The rejected 0034 admission draft is not a runtime dependency.
Deno.serve(endpoint.fetch)

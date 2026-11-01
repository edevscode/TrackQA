export const MAX_RESOLVER_RESPONSE_BYTES = 8_192
export const MAX_DATABASE_RESPONSE_BYTES = 65_536
const operations = ['resolve_mcp_connection', 'mcp_list_projects', 'mcp_list_issues', 'mcp_get_issue', 'mcp_submit_finding'] as const
export type RpcOperation = typeof operations[number]
type BackendOperation = RpcOperation | 'admit_mcp_request'
type FailureCode = 'configuration' | 'input' | 'transport' | 'http' | 'timeout' | 'response_limit' | 'invalid_response' | 'scope'
export interface RpcDiagnostic { operation: BackendOperation | 'unknown'; code: FailureCode; status?: number }
export type Diagnose = (event: Readonly<RpcDiagnostic>) => void
export type DatabaseRpc = (operation: RpcOperation, args: Record<string, unknown>) => Promise<unknown>
export interface DatabaseOptions {
  supabaseUrl?: string
  serviceRoleKey?: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  diagnose?: Diagnose
}

export class DatabaseError extends Error {
  readonly code: FailureCode
  readonly status?: number
  constructor(code: FailureCode, status?: number) {
    super('Data unavailable or access denied.')
    this.code = code
    this.status = status
  }
}

export function diagnostic(diagnose: Diagnose | undefined, operation: RpcDiagnostic['operation'], error: DatabaseError) {
  // Never pass inputs, URLs, hashes, response bodies or raw exception text.
  try { diagnose?.(Object.freeze({ operation, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) })) }
  catch { /* Diagnostics must not change the authorization/failure outcome. */ }
}

async function boundedJson(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new DatabaseError('invalid_response')
  const cancel = () => { void reader.cancel().catch(() => {}) }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw new DatabaseError('timeout')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) throw new DatabaseError('response_limit')
      text += decoder.decode(value, { stream: true })
    }
    if (signal.aborted) throw new DatabaseError('timeout')
    try { return JSON.parse(text + decoder.decode()) }
    catch { throw new DatabaseError('invalid_response') }
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

export function createDatabaseRpc(options: DatabaseOptions): DatabaseRpc {
  return createTransport(options, operations)
}

// Separate factory: admission remains excluded from the active data transport.
export function createAdmissionRpc(options: DatabaseOptions): () => Promise<unknown> {
  const rpc = createTransport({ ...options, timeoutMs: 1_000 }, ['admit_mcp_request'], 1_024)
  return () => rpc('admit_mcp_request', {})
}

function createTransport(options: DatabaseOptions, allowed: readonly BackendOperation[], responseLimit?: number) {
  const key = options.serviceRoleKey
  const secretKey = typeof key === 'string' && /^sb_secret_[A-Za-z0-9_-]{20,512}$/.test(key)
  let base: URL | undefined
  try {
    const url = new URL(options.supabaseUrl ?? '')
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/' && key && key.length <= 8192 && key.trim() === key && !/[\r\n]/.test(key)
      && (!key.startsWith('sb_') || secretKey)) base = url
  } catch { /* Invalid configuration fails closed on use; no connection here. */ }
  const fetchRpc = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  return async (operation: BackendOperation, args: Record<string, unknown>): Promise<unknown> => {
    const known = (allowed as readonly string[]).includes(operation)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    try {
      if (!known) throw new DatabaseError('input')
      if (!base || !key || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new DatabaseError('configuration')
      timeout = setTimeout(() => controller.abort(), timeoutMs)
      const response = await fetchRpc(new URL(`/rest/v1/rpc/${operation}`, base).href, {
        method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        // Modern secret keys authorize the backend via apikey; they are not JWTs.
        // Preserve Bearer only for legacy service-role JWT configurations.
        headers: { apikey: key, ...(!secretKey ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(args),
      })
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {})
        throw new DatabaseError('http', response.status)
      }
      return await boundedJson(response,
        responseLimit ?? (operation === 'resolve_mcp_connection' ? MAX_RESOLVER_RESPONSE_BYTES : MAX_DATABASE_RESPONSE_BYTES), controller.signal)
    } catch (cause) {
      const error = controller.signal.aborted ? new DatabaseError('timeout')
        : cause instanceof DatabaseError ? cause : new DatabaseError('transport')
      diagnostic(options.diagnose, known ? operation : 'unknown', error)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

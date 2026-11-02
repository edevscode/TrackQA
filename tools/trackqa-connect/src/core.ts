import { stripVTControlCharacters } from 'node:util'
import { mcpSetup, mcpTools } from '../../../src/lib/mcpOnboarding.ts'

export const SUPABASE_URL = 'https://mzeuimqfrswrwoaqjdmp.supabase.co'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const TOKEN = /^tqm_[0-9a-f]{64}$/
export const tools = mcpTools.map(tool => tool.name)
export const setupFor = (id: string) => mcpSetup(SUPABASE_URL, id)
export type Setup = ReturnType<typeof setupFor>
export type Project = { id: string; name: string; key: string; mcp_enabled: boolean; archived: boolean }
export type Api = (route: string, method?: 'GET' | 'POST' | 'PATCH', body?: unknown) => Promise<unknown>
export class ConnectorError extends Error {
  code: string
  constructor(code: string) { super('TrackQA connector operation did not complete.'); this.code = code }
}
export function requireValue(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ConnectorError(code)
}
export function display(value: string) { return [...stripVTControlCharacters(value)].filter(char => char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)).join('').slice(0, 160) }
export type Options = { command: 'connect' | 'status' | 'disconnect' | 'help'; client?: 'codex'; executable?: string; projectId?: string }
export function parseArgs(args: string[]): Options {
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) return { command: 'help' }
  requireValue(['connect', 'status', 'disconnect'].includes(args[0]), 'usage')
  const result: Options = { command: args[0] as Options['command'] }
  const seen = new Set<string>()
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1]
    requireValue(['--client', '--codex-path', '--project'].includes(flag) && !seen.has(flag) && value && !value.startsWith('--'), 'usage')
    seen.add(flag)
    if (flag === '--client') { requireValue(value === 'codex', 'client_unsupported'); result.client = value }
    if (flag === '--codex-path') result.executable = value
    if (flag === '--project') { requireValue(UUID.test(value), 'usage'); result.projectId = value.toLowerCase() }
  }
  return result
}
export async function boundedJson(response: Response, maxBytes = 1_048_576): Promise<unknown> {
  requireValue(!response.redirected && response.ok, 'request_failed')
  if (response.status === 204) return null
  const reader = response.body?.getReader()
  requireValue(reader, 'response_invalid')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      requireValue(size <= maxBytes, 'response_limit')
      chunks.push(value)
    }
    // PostgREST void RPCs may return an empty successful body. Callers of reads
    // and issuance still require their explicit array/object response shapes.
    if (size === 0) return null
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ConnectorError('response_invalid') }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

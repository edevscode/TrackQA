import { stripVTControlCharacters } from 'node:util'
import { mcpSetup, mcpTools } from '../../../src/lib/mcpOnboarding.ts'

export const SUPABASE_URL = 'https://mzeuimqfrswrwoaqjdmp.supabase.co'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const TOKEN = /^tqm_[0-9a-f]{64}$/
export const tools = mcpTools.map(tool => tool.name)
export type Client = 'codex' | 'gemini' | 'claude' | 'vscode'
export const setupFor = (id: string, client: Client = 'codex') => {
  const setup = mcpSetup(SUPABASE_URL, id)
  return client === 'codex' ? setup : { ...setup, serverName: `${setup.serverName}_${client}`, envVar: `${setup.envVar}_${client.toUpperCase()}` }
}
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
export type Options = { command: 'connect' | 'status' | 'disconnect' | 'help'; client?: Client; executable?: string; projectId?: string; claudeOnly?: boolean }
export function parseArgs(args: string[]): Options {
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) return { command: 'help' }
  requireValue(['connect', 'status', 'disconnect'].includes(args[0]), 'usage')
  const result: Options = { command: args[0] as Options['command'] }
  const seen = new Set<string>()
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]
    requireValue(!seen.has(flag), 'usage')
    seen.add(flag)
    if (flag === '--claude-only') { result.claudeOnly = true; continue }
    const value = args[++i]
    requireValue(['--client', '--codex-path', '--gemini-path', '--claude-path', '--vscode-path', '--project'].includes(flag) && value && !value.startsWith('--'), 'usage')
    if (flag === '--client') { requireValue(['codex', 'gemini', 'claude', 'vscode'].includes(value), 'client_unsupported'); result.client = value as Client }
    if (['--codex-path', '--gemini-path', '--claude-path', '--vscode-path'].includes(flag)) result.executable = value
    if (flag === '--project') { requireValue(UUID.test(value), 'usage'); result.projectId = value.toLowerCase() }
  }
  requireValue(['--codex-path', '--gemini-path', '--claude-path', '--vscode-path'].filter(flag => seen.has(flag)).length <= 1
    && (!seen.has('--gemini-path') || result.client === 'gemini')
    && (!seen.has('--codex-path') || !result.client || result.client === 'codex')
    && (!seen.has('--claude-path') || result.client === 'claude')
    && (!seen.has('--vscode-path') || result.client === 'vscode')
    && (!result.claudeOnly || (result.client === 'claude' && result.command === 'connect')), 'usage')
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

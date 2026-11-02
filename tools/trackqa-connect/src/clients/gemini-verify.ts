import { tools } from '../core.ts'
import type { Setup } from '../core.ts'
import type { Verification } from './codex-verify.ts'

// A native `mcp list` result is NOT tool discovery or a successful read call.
// Gemini has no verified equivalent of Codex's model-free app-server tool API.
export function geminiVerification(): Verification {
  return { authorized: null, verified: false, code: 'manual_verification_required' }
}
export function geminiInstructions(setup: Setup) {
  return `Gemini CLI availability and token-free installation passed. Client-side discovery: not verified. Authenticated reads: not verified. Gemini account sign-in is separate from TrackQA. In Gemini use /mcp to check this server and exactly these five tools: ${tools.join(', ')}. Call only trackqa_connection_status and trackqa_list_projects; confirm only project ${setup.projectId}. Do not submit a finding. Exit with /quit for cleanup. These manual checks are not machine-verified; the connector will keep its result unverified.`
}
export function assessGeminiDiscovery(names: readonly string[]) {
  const discovered = tools.filter(name => names.includes(name))
  return { discovered, complete: names.length === tools.length && new Set(names).size === tools.length && discovered.length === tools.length,
    authenticatedReadsVerified: false as const }
}

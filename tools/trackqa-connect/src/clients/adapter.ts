import type { Client, Setup } from '../core.ts'
import type { Executable } from './codex.ts'
import type { Verification } from './codex-verify.ts'

// codexHome remains optional here so existing Phase 1 adapter fixtures and
// recovery records keep their meaning; Gemini uses configurationHome instead.
export type Adapter = {
  client?: Client; label?: string; configurationHome?: string; codexHome?: string
  executable: Executable
  matches?: (value: unknown, setup: Setup) => boolean
  installPreview?: (setup: Setup) => string
  manualInstructions?: (setup: Setup) => string
  prepare?: () => Promise<void>
  entry: (setup: Setup) => Promise<unknown | null>
  install: (setup: Setup) => Promise<string>
  remove: (setup: Setup, hash: string | null) => Promise<void>
  launch: (setup: Setup, token: string, signal?: AbortSignal) => Promise<void>
  verify: (setup: Setup, token: string, signal?: AbortSignal) => Promise<Verification>
}
export const adapterClient = (adapter: Adapter) => adapter.client ?? 'codex'
export const adapterHome = (adapter: Adapter) => adapter.configurationHome ?? adapter.codexHome!
export const adapterLabel = (adapter: Adapter) => adapter.label ?? 'Codex'

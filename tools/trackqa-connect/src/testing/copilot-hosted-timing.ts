// Test-only controller timing. No process observation, credentials or API data.
import { ConnectorError, requireValue } from '../core.ts'

export const HOSTED_WINDOW_MS = 25 * 60_000
// Observed launch-to-model readiness took ~11 minutes (including manual setup).
// Reserve two minutes for activation/reads and one for managed access cleanup.
export const HOSTED_MIN_EXECUTION_MS = 14 * 60_000
export const HOSTED_ABORT_REASONS = ['deadline_expired', 'sigint_received', 'sigterm_received', 'controller_aborted', 'unknown_interruption'] as const
export type HostedAbortReason = typeof HOSTED_ABORT_REASONS[number]
type Event = 'preflight_start' | 'preflight_complete' | 'approval_requested' | 'approval_received' | 'deadline_established'
  | 'budget_checked' | 'launch_start' | 'native_readiness_observed' | 'first_abort' | 'cleanup_start' | 'cleanup_complete'
type Detail = { phase?: 'initial' | 'repeat'; approved?: boolean; deadlineAt?: string; remainingMs?: number; minimumMs?: number;
  stage?: 'before_mutation' | 'before_launch'; observation?: 'copilot_ready' | 'mcp_running_five_tools'; source?: 'manual_report';
  reason?: HostedAbortReason; duringCleanup?: boolean; confirmed?: boolean }
export type HostedTimingEvent = { event: Event; at: string } & Detail
type Timer = ReturnType<typeof setTimeout>

export class HostedAcceptanceTiming {
  private controller = new AbortController()
  private deadline?: number
  private timer?: Timer
  private firstReason?: HostedAbortReason
  private cleaning = false
  private evidenceFailed = false
  private now: () => number
  private emit: (event: HostedTimingEvent) => void
  private schedule: (callback: () => void, delay: number) => Timer
  private cancel: (timer: Timer) => void
  private external?: AbortSignal
  private onExternal = () => this.abort('unknown_interruption')

  constructor(options: { now?: () => number; emit?: (event: HostedTimingEvent) => void; signal?: AbortSignal;
    schedule?: (callback: () => void, delay: number) => Timer; cancel?: (timer: Timer) => void } = {}) {
    this.now = options.now ?? Date.now
    this.emit = options.emit ?? (() => {})
    this.schedule = options.schedule ?? ((callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return timer })
    this.cancel = options.cancel ?? clearTimeout
    this.external = options.signal
    this.external?.addEventListener('abort', this.onExternal, { once: true })
    if (this.external?.aborted) this.onExternal()
  }
  get signal() { return this.controller.signal }
  get abortReason() { return this.firstReason }
  record(event: Event, detail: Detail = {}) {
    // Callers supply enums/booleans/numbers only, never UI input or exceptions.
    try { this.emit({ event, at: new Date(this.now()).toISOString(), ...detail }) }
    catch {
      this.evidenceFailed = true
      this.abort('controller_aborted') // Logging must not prevent managed cleanup.
    }
  }
  establishDeadline() {
    if (this.deadline !== undefined) return // Approval and repeated preflight never reset it.
    this.deadline = this.now() + HOSTED_WINDOW_MS
    this.record('deadline_established', { deadlineAt: new Date(this.deadline).toISOString(), remainingMs: HOSTED_WINDOW_MS })
    this.timer = this.schedule(() => this.abort('deadline_expired'), HOSTED_WINDOW_MS)
  }
  abort(reason: HostedAbortReason = 'controller_aborted') {
    requireValue(HOSTED_ABORT_REASONS.includes(reason), 'fixture_timing_invalid')
    if (this.firstReason) return
    this.firstReason = reason
    this.record('first_abort', { reason, duringCleanup: this.cleaning })
    this.controller.abort(reason)
  }
  check() {
    if (this.deadline !== undefined && this.now() >= this.deadline) this.abort('deadline_expired')
    if (this.signal.aborted) throw new ConnectorError(this.firstReason ?? 'unknown_interruption')
  }
  requireBudget(stage: 'before_mutation' | 'before_launch') {
    this.check()
    requireValue(this.deadline !== undefined && !this.evidenceFailed, 'fixture_timing_unavailable')
    const remainingMs = Math.max(0, this.deadline - this.now())
    this.record('budget_checked', { stage, remainingMs, minimumMs: HOSTED_MIN_EXECUTION_MS, deadlineAt: new Date(this.deadline).toISOString() })
    this.check()
    requireValue(remainingMs >= HOSTED_MIN_EXECUTION_MS, 'insufficient_execution_budget')
  }
  observeReadiness(observation: 'copilot_ready' | 'mcp_running_five_tools') {
    this.check()
    this.record('native_readiness_observed', { observation, source: 'manual_report' })
  }
  cleanupStart() {
    if (this.cleaning) return
    this.cleaning = true
    this.record('cleanup_start')
  }
  cleanupComplete(confirmed: boolean) { this.record('cleanup_complete', { confirmed }) }
  classify(error: unknown) {
    if ((error instanceof ConnectorError && error.code === 'interrupted') || (error instanceof Error && error.name === 'AbortError')) {
      if (!this.firstReason) this.abort('unknown_interruption')
      return new ConnectorError(this.firstReason!)
    }
    return error // Never hide a separate cleanup failure behind an earlier abort.
  }
  dispose() {
    if (this.timer) this.cancel(this.timer)
    this.external?.removeEventListener('abort', this.onExternal)
  }
}

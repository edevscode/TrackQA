import type { DeadlineMode, DeadlineTiming, IssueDeadlines, IssueStatus } from './database.types'
import { localTimeInput, userTimezone } from './timezones.ts'

export const deadlineKeys = ['start_by', 'ready_for_qa_by', 'qa_decision_by', 'resolve_by'] as const
export type DeadlineKey = typeof deadlineKeys[number]
export const timeKeys = { start_by: 'start_time', ready_for_qa_by: 'ready_for_qa_time', qa_decision_by: 'qa_decision_time', resolve_by: 'resolve_time' } as const
export const cutoffKeys = { start_by: 'start_cutoff_at', ready_for_qa_by: 'ready_for_qa_cutoff_at', qa_decision_by: 'qa_decision_cutoff_at', resolve_by: 'resolve_cutoff_at' } as const
export const timezoneKeys = { start_by: 'start_timezone', ready_for_qa_by: 'ready_for_qa_timezone', qa_decision_by: 'qa_decision_timezone', resolve_by: 'resolve_timezone' } as const
export type DeadlineInput = Record<DeadlineKey | typeof timeKeys[DeadlineKey], string> & { entry_timezone: string; deadline_mode: DeadlineMode; end_of_day: Record<DeadlineKey, boolean> }
export type DeadlineFilter = '' | 'overdue' | 'missed' | 'upcoming'
export type DeadlineSort = 'newest' | 'deadline' | 'next'
export const dueSoonWindowMs = 7 * 24 * 60 * 60 * 1000
export const emptyDeadlines: DeadlineInput = { entry_timezone: '', deadline_mode: 'none', end_of_day: { start_by: true, ready_for_qa_by: true, qa_decision_by: true, resolve_by: true }, resolve_by: '', start_by: '', ready_for_qa_by: '', qa_decision_by: '', resolve_time: '', start_time: '', ready_for_qa_time: '', qa_decision_time: '' }
export const deadlineLabels: Record<DeadlineKey, string> = { resolve_by: 'Resolve by', start_by: 'Start work by', ready_for_qa_by: 'Ready for QA by', qa_decision_by: 'QA decision by' }
export const modeLabels = { none: 'No deadline', single: 'Single deadline', stages: 'Stage deadlines' }
type DeadlineSource = Partial<Record<DeadlineKey, string | null>> & Partial<DeadlineTiming> & { deadline_timezone?: string; entry_timezone?: string; end_of_day?: Record<DeadlineKey, boolean> }

export function deadlineMode(source: DeadlineSource): DeadlineMode {
  return source.deadline_mode ?? (deadlineKeys.slice(0, 3).some((key) => !!source[key]) ? 'stages' : source.resolve_by ? 'single' : 'none')
}
export function activeDeadlineKeys(mode: DeadlineMode): readonly DeadlineKey[] {
  return mode === 'none' ? [] : mode === 'single' ? ['resolve_by'] : deadlineKeys
}
export function deadlineLabel(key: DeadlineKey, mode: DeadlineMode) {
  return key === 'resolve_by' && mode === 'stages' ? 'Close by' : deadlineLabels[key]
}
export function deadlineInput(source: DeadlineSource, timezone = userTimezone()): DeadlineInput {
  const input = { ...emptyDeadlines, entry_timezone: timezone, end_of_day: { ...emptyDeadlines.end_of_day }, deadline_mode: deadlineMode(source) }
  for (const key of deadlineKeys) {
    const sourceTimezone = source[timezoneKeys[key]] || source.deadline_timezone || source.entry_timezone || timezone
    if ((source.end_of_day && ((source.entry_timezone || timezone) === timezone || (!source.end_of_day[key] && !source[timeKeys[key]])))
        || (!source[cutoffKeys[key]] && sourceTimezone === timezone)) {
      input[key] = source[key] ?? ''
      input[timeKeys[key]] = source[timeKeys[key]] ?? ''
      input.end_of_day[key] = source.end_of_day?.[key] ?? !source[timeKeys[key]]
      continue
    }
    const displayed = displayedDeadline(source, key, timezone)
    input[key] = displayed?.date ?? ''
    input[timeKeys[key]] = displayed?.time ?? ''
    input.end_of_day[key] = !displayed?.time
  }
  return input
}
function unchangedTarget(input: DeadlineInput, baseline: DeadlineInput, key: DeadlineKey) {
  return input[key] === baseline[key] && input.end_of_day[key] === baseline.end_of_day[key]
    && (input.end_of_day[key] || input[timeKeys[key]] === baseline[timeKeys[key]])
}
export function deadlinePayload(input: DeadlineInput, original?: DeadlineSource) {
  const active = activeDeadlineKeys(input.deadline_mode)
  const baseline = original ? deadlineInput(original, input.entry_timezone) : null
  const payload = { deadline_mode: input.deadline_mode } as { deadline_mode: DeadlineMode } & Record<DeadlineKey | typeof timeKeys[DeadlineKey] | typeof timezoneKeys[DeadlineKey], string | null>
  for (const key of deadlineKeys) {
    const preserve = active.includes(key) && original && baseline && unchangedTarget(input, baseline, key)
    payload[key] = preserve ? original[key] ?? null : active.includes(key) ? input[key] || null : null
    payload[timeKeys[key]] = payload[key] ? preserve ? original![timeKeys[key]] ?? null : input.end_of_day[key] ? null : input[timeKeys[key]] || null : null
    payload[timezoneKeys[key]] = payload[key] ? preserve ? original![timezoneKeys[key]] ?? original!.deadline_timezone ?? input.entry_timezone : input.entry_timezone : null
  }
  return payload
}
export function removedDeadlineTargets(source: DeadlineSource, input: DeadlineInput) {
  if (deadlineMode(source) === input.deadline_mode) return []
  const payload = deadlinePayload(input)
  return deadlineKeys.filter((key) => !!source[key] && !payload[key])
}

export function dateInTimezone(instant: Date | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  const value = (type: string) => parts.find((part) => part.type === type)?.value
  return `${value('year')?.padStart(4, '0')}-${value('month')}-${value('day')}`
}

function wallClock(instant: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
  const value = (type: string) => parts.find((part) => part.type === type)!.value
  const year = value('year').length > 4 ? `+${value('year').padStart(6, '0')}` : value('year').padStart(4, '0')
  return `${year}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`
}

/** Resolve a wall-clock input without silently shifting DST gaps or overlaps. */
export function localDeadlineInstant(date: string, time: string | null, timezone: string): number {
  const normalizedTime = time ? (time.length === 5 ? `${time}:00` : time) : null
  const wall = normalizedTime ? `${date}T${normalizedTime.split('.')[0]}` : new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().replace(/\.\d+Z$/, '')
  const local = Date.parse(normalizedTime ? `${date}T${normalizedTime}Z` : `${wall}Z`)
  const offsets = new Set([-2, 0, 2].map((days) => {
    const probe = local + days * 86_400_000
    return Date.parse(`${wallClock(probe, timezone)}Z`) - Math.floor(probe / 1000) * 1000
  }))
  const matches = [...offsets].map((offset) => local - offset).filter((candidate) => wallClock(candidate, timezone) === wall)
  if (!time) {
    const afterGap = [...offsets].map((offset) => local - offset).filter((candidate) => wallClock(candidate, timezone) > wall)
    const cutoff = Math.min(...(matches.length ? matches : afterGap)) - 1
    if (!Number.isFinite(cutoff) || dateInTimezone(new Date(cutoff), timezone) !== date) throw new Error('This calendar date does not exist because of a clock change.')
    return cutoff
  }
  if (matches.length === 0) throw new Error('This local time does not exist because of a clock change. Choose another time.')
  if (matches.length !== 1) throw new Error('This local time occurs twice because of a clock change. Choose an unambiguous time.')
  return matches[0]
}

export function validateDeadlines(input: DeadlineInput, timezone = input.entry_timezone || userTimezone(), original?: DeadlineSource): string | null {
  if (!['none', 'single', 'stages'].includes(input.deadline_mode)) return 'Choose a deadline type.'
  if (input.deadline_mode === 'single' && !input.resolve_by) return 'Choose a Resolve by date or select No deadline.'
  const keys = activeDeadlineKeys(input.deadline_mode)
  if (input.deadline_mode === 'stages' && !keys.some((key) => !!input[key])) return 'Add at least one stage target or select No deadline.'
  let previous: { key: DeadlineKey; instant: number } | null = null
  const baseline = original ? deadlineInput(original, timezone) : null
  for (const key of keys) {
    const date = input[key]
    if (!date) continue
    const parsed = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '0001-01-01') return `Choose a valid date for ${deadlineLabel(key, input.deadline_mode)}.`
    const time = input.end_of_day[key] ? '' : input[timeKeys[key]]
    if (!input.end_of_day[key] && !time) return `Choose a time for ${deadlineLabel(key, input.deadline_mode)} or select End of day.`
    if (time && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time)) return `Choose a valid time for ${deadlineLabel(key, input.deadline_mode)}.`
    let instant: number
    try {
      const preserved = original && baseline && unchangedTarget(input, baseline, key) ? rawDeadlineCutoff(original, key, timezone) : null
      instant = preserved ?? localDeadlineInstant(date, time || null, timezone)
    }
    catch (error) { return `${deadlineLabel(key, input.deadline_mode)}: ${(error as Error).message}` }
    if (previous && previous.instant > instant) return `${deadlineLabel(key, input.deadline_mode)} must be on or after ${deadlineLabel(previous.key, input.deadline_mode)}.`
    previous = { key, instant }
  }
  return null
}

export function formatDeadline(date: string, time: string | null = null, timezone?: string) {
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
  return `${label} · ${time ? time.length > 5 ? time.replace(/:00$/, '') : time : 'End of day'}${timezone ? ` (${timezone})` : ''}`
}

function rawDeadlineCutoff(source: DeadlineSource, key: DeadlineKey, fallback: string): number | null {
  if (!source[key]) return null
  const stored = source[cutoffKeys[key]]
  if (stored) return Date.parse(stored)
  const time = source.end_of_day?.[key] ? null : source[timeKeys[key]] ?? null
  return localDeadlineInstant(source[key], time, source[timezoneKeys[key]] || source.deadline_timezone || source.entry_timezone || fallback)
}
export function displayedDeadline(source: DeadlineSource, key: DeadlineKey, timezone = userTimezone()) {
  const cutoff = rawDeadlineCutoff(source, key, timezone)
  if (cutoff === null) return null
  const date = dateInTimezone(new Date(cutoff), timezone)
  const endOfDay = dateInTimezone(new Date(cutoff + 1), timezone) !== date
  return { date, time: endOfDay ? null : localTimeInput(cutoff, timezone), timezone }
}
export function formatSavedDeadline(source: DeadlineSource, key: DeadlineKey, timezone = userTimezone()) {
  const displayed = displayedDeadline(source, key, timezone)
  return displayed ? formatDeadline(displayed.date, displayed.time, timezone) : 'Not scheduled'
}

export function deadlineCutoff(source: DeadlineSource & { deadline_timezone: string }, key: DeadlineKey) {
  if (!activeDeadlineKeys(deadlineMode(source)).includes(key) || !source[key]) return null
  return rawDeadlineCutoff(source, key, source.deadline_timezone)
}
export function deadlineState(issue: IssueDeadlines & { status: IssueStatus }, now = new Date()) {
  const mode = deadlineMode(issue)
  const reached = { start_by: issue.work_started_at, ready_for_qa_by: issue.ready_for_qa_at, qa_decision_by: issue.qa_decided_at, resolve_by: issue.completed_at }
  const targets = activeDeadlineKeys(mode).map((key) => {
    const target = issue[key]
    const actual = reached[key]
    const alreadyReached = key === 'start_by' ? issue.status !== 'OPEN'
      : key === 'ready_for_qa_by' ? ['FOR_TESTING', 'PASSED', 'FAILED', 'DONE'].includes(issue.status)
      : key === 'qa_decision_by' ? ['PASSED', 'FAILED', 'DONE'].includes(issue.status) : issue.status === 'DONE'
    const unknown = alreadyReached && !actual
    const cutoff = deadlineCutoff(issue, key)
    const late = cutoff !== null && !unknown && cutoff < (actual ? Date.parse(actual) : now.getTime())
    return { key, target, time: issue[timeKeys[key]], actual, late, unknown, cutoff }
  })
  const resolution = deadlineCutoff(issue, 'resolve_by')
  const pending = issue.status === 'DONE' ? undefined : targets.find((target) => target.cutoff !== null && !target.actual && !target.unknown)
  const nextCutoff = pending?.cutoff ?? null
  return {
    targets,
    overdue: issue.status !== 'DONE' && resolution !== null && resolution < now.getTime(),
    missedStage: mode === 'stages' && targets.some((target) => target.key !== 'resolve_by' && target.late),
    completedLate: issue.status === 'DONE' && targets.some((target) => target.key === 'resolve_by' && target.late),
    nextKey: pending?.key ?? null,
    nextCutoff,
    dueSoon: nextCutoff !== null && nextCutoff >= now.getTime() && nextCutoff <= now.getTime() + dueSoonWindowMs,
  }
}
export function compareResolutionDates(a: DeadlineSource & { deadline_timezone: string; status?: IssueStatus }, b: DeadlineSource & { deadline_timezone: string; status?: IssueStatus }) {
  const cutoff = (issue: typeof a) => issue.status === 'DONE' ? Infinity : deadlineCutoff(issue, 'resolve_by') ?? Infinity
  const first = cutoff(a), second = cutoff(b)
  return first === second ? 0 : first < second ? -1 : 1
}

export function comparePendingDeadlines(a: IssueDeadlines & { status: IssueStatus }, b: IssueDeadlines & { status: IssueStatus }) {
  const first = deadlineState(a).nextCutoff ?? Infinity
  const second = deadlineState(b).nextCutoff ?? Infinity
  return first === second ? 0 : first < second ? -1 : 1
}

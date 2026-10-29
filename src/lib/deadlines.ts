import type { IssueDeadlines, IssueStatus } from './database.types'

export const deadlineKeys = ['start_by', 'ready_for_qa_by', 'qa_decision_by', 'resolve_by'] as const
export type DeadlineKey = typeof deadlineKeys[number]
export type DeadlineInput = Record<DeadlineKey, string>
export type DeadlineFilter = '' | 'overdue' | 'missed'
export const emptyDeadlines: DeadlineInput = { resolve_by: '', start_by: '', ready_for_qa_by: '', qa_decision_by: '' }
export const deadlineLabels: Record<DeadlineKey, string> = {
  resolve_by: 'Resolve by', start_by: 'Start work by', ready_for_qa_by: 'Ready for QA by', qa_decision_by: 'QA decision by',
}

export function deadlineInput(source: Partial<Record<DeadlineKey, string | null>>): DeadlineInput {
  return Object.fromEntries(deadlineKeys.map((key) => [key, source[key] ?? ''])) as DeadlineInput
}
export function deadlinePayload(input: DeadlineInput) {
  return Object.fromEntries(deadlineKeys.map((key) => [key, input[key] || null])) as Record<DeadlineKey, string | null>
}
export function validateDeadlines(input: DeadlineInput): string | null {
  let previous: DeadlineKey | null = null
  for (const key of deadlineKeys) {
    const date = input[key]
    if (!date) continue
    const parsed = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '0001-01-01') {
      return `Choose a valid date for ${deadlineLabels[key]}.`
    }
    if (previous && input[previous] > date) return `${deadlineLabels[key]} must be on or after ${deadlineLabels[previous]}.`
    previous = key
  }
  return null
}

export function dateInTimezone(instant: Date | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  const value = (type: string) => parts.find((part) => part.type === type)?.value
  return `${value('year')?.padStart(4, '0')}-${value('month')}-${value('day')}`
}
export function formatDeadline(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export function deadlineState(issue: IssueDeadlines & { status: IssueStatus }, nowOrProjectDay: Date | string = new Date()) {
  const today = typeof nowOrProjectDay === 'string' ? nowOrProjectDay : dateInTimezone(nowOrProjectDay, issue.deadline_timezone)
  const reached = { start_by: issue.work_started_at, ready_for_qa_by: issue.ready_for_qa_at, qa_decision_by: issue.qa_decided_at, resolve_by: issue.completed_at }
  const targets = deadlineKeys.map((key) => {
    const target = issue[key]
    const actual = reached[key]
    // Legacy resolved issues have no measured timestamps. Do not invent misses.
    const alreadyReached = key === 'start_by' ? issue.status !== 'OPEN'
      : key === 'ready_for_qa_by' ? ['FOR_TESTING', 'PASSED', 'FAILED', 'DONE'].includes(issue.status)
      : key === 'qa_decision_by' ? ['PASSED', 'FAILED', 'DONE'].includes(issue.status)
      : issue.status === 'DONE'
    const unknown = alreadyReached && !actual
    const late = !!target && !unknown && target < (actual ? dateInTimezone(actual, issue.deadline_timezone) : today)
    return { key, target, actual, late, unknown }
  })
  return {
    targets,
    overdue: issue.status !== 'DONE' && !!issue.resolve_by && issue.resolve_by < today,
    missedStage: targets.some((target) => target.key !== 'resolve_by' && target.late),
    completedLate: issue.status === 'DONE' && targets.some((target) => target.key === 'resolve_by' && target.late),
  }
}

export function compareResolutionDates(a: Pick<IssueDeadlines, 'resolve_by'> & { status?: IssueStatus }, b: Pick<IssueDeadlines, 'resolve_by'> & { status?: IssueStatus }) {
  const date = (issue: typeof a) => issue.status === 'DONE' ? '9999-12-31' : issue.resolve_by ?? '9999-12-31'
  return date(a).localeCompare(date(b))
}

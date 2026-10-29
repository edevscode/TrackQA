import type { DeadlineHistory } from './database.types'
import { activeDeadlineKeys, deadlineKeys, deadlineMode } from './deadlines.ts'

export function relevantDeadlineHistory(entry: DeadlineHistory): boolean {
  const mode = deadlineMode(entry.after_values)
  const before = entry.before_values ? deadlineMode(entry.before_values) : null
  if (before !== null && before !== mode) return true
  if (mode === 'none') return false
  if (entry.event === 'CREATED' || entry.event === 'TARGETS_CHANGED') return true
  return mode === 'stages' || (entry.event === 'MILESTONE_REACHED' && entry.after_values.status === 'DONE')
}

export function deadlineHistoryLabel(entry: DeadlineHistory): string {
  const mode = deadlineMode(entry.after_values)
  if (entry.before_values && deadlineMode(entry.before_values) !== mode) return 'Deadline type changed'
  if (entry.event === 'CREATED') return 'Deadline set'
  if (entry.event === 'TARGETS_CHANGED') return mode === 'stages' ? 'Stage targets changed' : 'Deadline changed'
  if (mode === 'single') return 'Issue resolved'
  return entry.event === 'REWORK_STARTED' ? 'Development resumed' : 'Milestone recorded'
}

export function deadlineHistoryKeys(entry: DeadlineHistory) {
  const mode = deadlineMode(entry.after_values)
  const keys = new Set(activeDeadlineKeys(mode))
  // Removed targets belong in the explicit mode-change audit, even when
  // their fields are no longer part of the currently selected deadline type.
  if (entry.before_values && deadlineMode(entry.before_values) !== mode) {
    for (const key of deadlineKeys) if (entry.before_values[key]) keys.add(key)
  }
  return deadlineKeys.filter((key) => keys.has(key) && (entry.after_values[key] || entry.before_values?.[key]))
}

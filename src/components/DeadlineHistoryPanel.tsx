import type { DeadlineHistory } from '../lib/database.types'
import { deadlineLabel, deadlineMode, modeLabels, timeKeys, timezoneKeys, formatSavedDeadline } from '../lib/deadlines'
import { relevantDeadlineHistory, deadlineHistoryLabel, deadlineHistoryKeys } from '../lib/deadlineHistory'
import { useDeadlineClock, useUserTimezone } from '../hooks/useDeadlineClock'

export default function DeadlineHistoryPanel({ entries, members }: { entries: DeadlineHistory[]; members: { user_id: string; full_name: string | null }[] }) {
  useDeadlineClock()
  const timezone = useUserTimezone()
  const visibleEntries = entries.filter(relevantDeadlineHistory)
  if (!visibleEntries.length) return null
  return (
    <details className="mb-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
      <summary className="cursor-pointer text-label-md font-semibold">Deadline history ({visibleEntries.length}{entries.length === 100 ? ' recent' : ''})</summary>
      <ol className="mt-sm space-y-sm">
        {visibleEntries.map((entry) => {
          const actor = members.find((member) => member.user_id === entry.actor_id)?.full_name ?? (entry.actor_id ? `Member ${entry.actor_id.slice(0, 8)}` : 'System')
          const after = entry.after_values
          const mode = deadlineMode(after)
          const beforeMode = entry.before_values ? deadlineMode(entry.before_values) : null
          return (
            <li key={entry.id} className="rounded border border-outline-variant p-sm text-body-md">
              <p className="font-semibold">{deadlineHistoryLabel(entry)}{mode === 'stages' ? ` · cycle ${entry.work_cycle} · ${after.status}` : ''}</p>
              <p className="text-on-surface-variant">{actor} · {new Date(entry.created_at).toLocaleString('en-US', { timeZone: timezone })} ({timezone})</p>
              <p className="mt-xs">Deadline type: {beforeMode && beforeMode !== mode ? `${modeLabels[beforeMode]} → ` : ''}{modeLabels[mode]}</p>
              <dl className="mt-xs grid gap-xs sm:grid-cols-2">
                {deadlineHistoryKeys(entry).map((key) => {
                  const before = entry.before_values?.[key]
                  const target = after[key]
                  const oldTime = entry.before_values?.[timeKeys[key]] ?? null
                  const time = after[timeKeys[key]] ?? null
                  const changed = before !== undefined && (before !== target || oldTime !== time || entry.before_values?.[timezoneKeys[key]] !== after[timezoneKeys[key]])
                  const previous = entry.before_values ? formatSavedDeadline({ ...entry.before_values, deadline_timezone: entry.before_values.timezone }, key, timezone) : 'Not scheduled'
                  return <div key={key}><dt className="inline font-medium">{deadlineLabel(key, mode)}: </dt><dd className="inline">{changed && <span>{previous} → </span>}{target ? formatSavedDeadline({ ...after, deadline_timezone: after.timezone }, key, timezone) : 'Not scheduled'}</dd></div>
                })}
              </dl>
              {mode === 'stages' && entry.event === 'REWORK_STARTED' && entry.before_values?.qa_decided_at && (
                <p className="mt-xs text-on-surface-variant">Previous cycle QA: {entry.before_values.status} at {new Date(entry.before_values.qa_decided_at).toLocaleString('en-US', { timeZone: timezone })}. Earlier targets and results remain in this history.</p>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

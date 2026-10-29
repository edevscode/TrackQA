import type { IssueDeadlines, IssueStatus } from '../lib/database.types'
import { deadlineLabel, deadlineMode, deadlineState, formatSavedDeadline, modeLabels } from '../lib/deadlines'
import { useDeadlineClock, useUserTimezone } from '../hooks/useDeadlineClock'

export default function DeadlineSummary({ issue, compact = false }: { issue: IssueDeadlines & { status: IssueStatus }; compact?: boolean }) {
  useDeadlineClock()
  const timezone = useUserTimezone()
  const state = deadlineState(issue)
  const mode = deadlineMode(issue)
  if (mode === 'none') return <p className={compact ? 'text-body-md text-on-surface-variant' : 'mb-md text-body-md text-on-surface-variant'}>No deadline</p>
  const resolution = state.targets.find((target) => target.key === 'resolve_by')
  const nextTarget = state.targets.find((target) => target.key !== 'resolve_by' && target.target && !target.actual && !target.unknown)
    ?? [...state.targets].reverse().find((target) => target.key !== 'resolve_by' && target.target)
  const badge = state.overdue ? 'Resolution overdue' : state.completedLate ? 'Completed late' : state.missedStage ? 'Stage target missed' : null
  return (
    <div className={compact ? 'mt-xs space-y-xs text-body-md' : 'mb-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md'}>
      {!compact && <h2 className="mb-sm text-body-md font-bold">{modeLabels[mode]}{mode === 'stages' ? ` · work cycle ${issue.work_cycle}` : ''}</h2>}
      {badge && <span className="mr-xs inline-block rounded border border-amber-600/40 bg-amber-500/10 px-xs py-0.5 text-label-md font-semibold text-on-surface">{badge}</span>}
      {compact ? (
        <div className="text-on-surface-variant">
          <span>{modeLabels[mode]}</span>
          {resolution?.target && <span className="block">{deadlineLabel('resolve_by', mode)} {formatSavedDeadline(issue, 'resolve_by', timezone)}</span>}
          {nextTarget?.target && <span className="block">{deadlineLabel(nextTarget.key, mode)} {formatSavedDeadline(issue, nextTarget.key, timezone)}</span>}
        </div>
      ) : (
        <>
          <p className="mb-sm text-body-md text-on-surface-variant">Your timezone: {timezone}</p>
          <dl className={`grid gap-sm ${mode === 'stages' ? 'sm:grid-cols-2 lg:grid-cols-4' : ''}`}>
            {state.targets.map(({ key, target, actual, late, unknown }) => (
              <div key={key} className="rounded border border-outline-variant p-sm">
                <dt className="text-label-md font-semibold">{deadlineLabel(key, mode)}</dt>
                <dd className="mt-xs text-body-md">{target ? formatSavedDeadline(issue, key, timezone) : 'Not scheduled'}</dd>
                <dd className="mt-xs text-body-md text-on-surface-variant">{actual ? `${late ? 'Completed late' : target ? 'Met target' : 'Recorded'} · ${new Date(actual).toLocaleString('en-US', { timeZone: timezone })}` : unknown ? 'Timing unavailable' : late ? 'Target missed · pending' : 'Pending'}</dd>
              </div>
            ))}
          </dl>
          {mode === 'stages' && issue.status === 'FAILED' && <p className="mt-sm text-body-md text-on-surface-variant">This attempt's QA decision is recorded. Resuming development starts the next work cycle and retains the saved targets.</p>}
        </>
      )}
    </div>
  )
}

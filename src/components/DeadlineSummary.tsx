import type { IssueDeadlines, IssueStatus } from '../lib/database.types'
import { deadlineLabels, deadlineState, formatDeadline } from '../lib/deadlines'
import { useDeadlineDay } from '../hooks/useDeadlineDay'

export default function DeadlineSummary({ issue, compact = false }: { issue: IssueDeadlines & { status: IssueStatus }; compact?: boolean }) {
  useDeadlineDay(issue.deadline_timezone)
  const state = deadlineState(issue)
  const nextTarget = state.targets.find((target) => target.key !== 'resolve_by' && target.target && !target.actual && !target.unknown)
  const badge = state.overdue ? 'Resolution overdue' : state.completedLate ? 'Completed late' : state.missedStage ? 'Stage target missed' : null
  return (
    <div className={compact ? 'mt-xs space-y-xs text-body-md' : 'mb-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md'}>
      {!compact && <h2 className="mb-sm text-body-md font-bold">Timeline · cycle {issue.work_cycle}</h2>}
      {badge && <span className="mr-xs inline-block rounded border border-amber-600/40 bg-amber-500/10 px-xs py-0.5 text-label-md font-semibold text-on-surface">{badge}</span>}
      {compact ? (
        <div className="text-on-surface-variant">
          <span>{issue.resolve_by ? `Resolve by ${formatDeadline(issue.resolve_by)}` : 'No resolution deadline'}</span>
          {nextTarget?.target && <span className="block">{deadlineLabels[nextTarget.key]} {formatDeadline(nextTarget.target)}</span>}
        </div>
      ) : (
        <>
          <p className="mb-sm text-body-md text-on-surface-variant">End of day in {issue.deadline_timezone}. The issue is resolved when it reaches Done.</p>
          <dl className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
            {state.targets.map(({ key, target, actual, late, unknown }) => (
              <div key={key} className="rounded border border-outline-variant p-sm">
                <dt className="text-label-md font-semibold">{deadlineLabels[key]}</dt>
                <dd className="mt-xs text-body-md">{target ? formatDeadline(target) : 'Not scheduled'}</dd>
                <dd className="mt-xs text-body-md text-on-surface-variant">{actual ? `${late ? 'Completed late' : target ? 'Met target' : 'Recorded'} · ${new Date(actual).toLocaleString('en-US', { timeZone: issue.deadline_timezone })}` : unknown ? 'Timing unavailable' : late ? 'Target missed · pending' : 'Pending'}</dd>
              </div>
            ))}
          </dl>
          {issue.status === 'FAILED' && <p className="mt-sm text-body-md text-on-surface-variant">The QA decision for this attempt is recorded. Resuming development starts the next cycle and keeps these target dates. Review them before retesting.</p>}
        </>
      )}
    </div>
  )
}

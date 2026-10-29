import { Link } from 'react-router-dom'
import type { IssueStatus, ProjectDashboardStats } from '../lib/database.types'
import { issueTotals } from '../lib/issueWork'

export default function IssueWorkOverview({ stats, unassignedCount, owner }: {
  stats: ProjectDashboardStats | null; unassignedCount: number; owner: boolean
}) {
  const totals = issueTotals(stats)
  const stages: { status: IssueStatus; label: string; count: number }[] = [
    { status: 'OPEN', label: 'Open', count: stats?.open_issues ?? 0 },
    { status: 'IN_PROGRESS', label: 'In progress', count: stats?.in_progress_issues ?? 0 },
    { status: 'FAILED', label: 'Needs rework', count: stats?.failed_issues ?? 0 },
    { status: 'FOR_TESTING', label: 'Ready for QA', count: stats?.for_testing_issues ?? 0 },
    { status: 'PASSED', label: 'Awaiting closure', count: stats?.passed_issues ?? 0 },
  ]
  return (
    <section aria-label="Project workload" className="mb-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:p-lg">
      <h2 className="text-headline-md font-semibold">Project workload</h2>
      <div className="my-md grid gap-sm sm:grid-cols-2">
        <Link to="/issues?view=active" className="rounded-md border border-outline-variant p-md hover:border-primary">
          <span className="block text-body-md font-semibold">Active issues</span>
          <strong className="text-headline-xl">{totals.active}</strong>
          <span className="ml-sm text-body-md text-on-surface-variant">Unfinished work, including passed issues awaiting closure</span>
        </Link>
        <Link to="/issues?view=completed" className="rounded-md border border-outline-variant p-md hover:border-primary">
          <span className="block text-body-md font-semibold">Completed</span>
          <strong className="text-headline-xl">{totals.completed}</strong>
          <span className="ml-sm text-body-md text-on-surface-variant">{stats?.completed_this_week ?? 0} closed this week · {totals.all} issues overall</span>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-sm sm:grid-cols-3 xl:grid-cols-5">
        {stages.map((stage) => <Link key={stage.status} to={`/issues?view=active&status=${stage.status}`} className="rounded-md border border-outline-variant bg-surface-container-low p-sm hover:border-primary">
          <span className="block text-label-md font-semibold">{stage.label}</span>
          <strong className="text-headline-lg">{stage.count}</strong>
        </Link>)}
      </div>
      {owner && <Link to="/issues?view=active&assignee=unassigned" className="mt-md flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant pt-md text-body-md font-semibold text-primary hover:underline">
        <span>Unassigned issues · {unassignedCount}</span><span>Review assignments →</span>
      </Link>}
    </section>
  )
}

import { Link } from 'react-router-dom'
import type { ProjectDashboardStats } from '../lib/database.types'

type Stats = Pick<ProjectDashboardStats, 'overdue_issues' | 'missed_target_issues' | 'due_soon_issues'>

export default function DeadlineOverview({ stats }: { stats: Stats | null }) {
  const cards = [
    { label: 'Due soon', count: stats?.due_soon_issues ?? 0, filter: 'upcoming', description: 'Unresolved issues with a pending deadline in the next 7 days' },
    { label: 'Missed stage targets', count: stats?.missed_target_issues ?? 0, filter: 'missed', description: 'Active issues with a pending or late milestone' },
    { label: 'Resolution overdue', count: stats?.overdue_issues ?? 0, filter: 'overdue', description: 'Unresolved issues past their final deadline' },
  ]
  return (
    <section aria-label="Deadline overview" className="mb-md grid gap-sm lg:grid-cols-3">
      {cards.map((card) => (
        <Link key={card.filter} to={`/issues?deadline=${card.filter}`} className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md hover:border-primary focus-visible:outline-2">
          <span className="block text-label-md font-semibold">{card.label}</span>
          <strong className="block text-headline-xl">{card.count}</strong>
          <span className="mt-xs block text-body-md text-on-surface-variant">{card.description}</span>
        </Link>
      ))}
    </section>
  )
}

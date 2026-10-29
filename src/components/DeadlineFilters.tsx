import type { DeadlineFilter } from '../lib/deadlines'

export default function DeadlineFilters({ filter, onChange, sort, onSort }: {
  filter: DeadlineFilter; onChange: (value: DeadlineFilter) => void
  sort?: 'newest' | 'deadline'; onSort?: (value: 'newest' | 'deadline') => void
}) {
  return (
    <div className="mb-md flex flex-wrap gap-sm text-body-md">
      <label className="flex items-center gap-xs">Deadlines
        <select value={filter} onChange={(event) => onChange(event.target.value as DeadlineFilter)} className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs focus-visible:outline-2">
          <option value="">All issues</option><option value="overdue">Resolution overdue</option><option value="missed">Missed stage targets</option>
        </select>
      </label>
      {onSort && <label className="flex items-center gap-xs">Order
        <select value={sort} onChange={(event) => onSort(event.target.value as 'newest' | 'deadline')} className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs focus-visible:outline-2">
          <option value="newest">Newest first</option><option value="deadline">Nearest resolution deadline</option>
        </select>
      </label>}
    </div>
  )
}

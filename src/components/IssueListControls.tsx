import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ListFilter, Search } from 'lucide-react'
import type { IssueLifecycle } from '../lib/issueWork'
import IssueLifecycleTabs from './IssueLifecycleTabs'

export function FilterSelect({ label, value, onChange, children }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode
}) {
  return <label className="block text-label-md font-medium text-on-surface-variant">
    <span className="mb-xs block">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-sm text-body-md text-on-surface focus-visible:outline-2">
      {children}
    </select>
  </label>
}

export default function IssueListControls({ lifecycle, onLifecycleChange, search, onSearchChange, filterCount, summary, hasFilters, onClear, children }: {
  lifecycle: IssueLifecycle; onLifecycleChange: (value: IssueLifecycle) => void
  search: string; onSearchChange: (value: string) => void; filterCount: number
  summary: string; hasFilters: boolean; onClear: () => void; children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  return <section aria-label="Issue list controls" className="mb-md border-b border-outline-variant pb-md">
    <div className="flex flex-wrap items-center justify-between gap-sm">
      <IssueLifecycleTabs value={lifecycle} onChange={onLifecycleChange} />
      <div className="flex w-full items-center gap-sm sm:w-auto sm:flex-1 sm:justify-end">
        <label className="flex min-w-0 flex-1 items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-sm sm:max-w-[320px]">
          <Search size={16} className="shrink-0 text-outline" />
          <input type="text" role="searchbox" aria-label="Search this list" placeholder="Search this list…" value={search} onChange={(event) => onSearchChange(event.target.value)} className="w-full min-w-0 bg-transparent text-body-md text-on-surface outline-none placeholder:text-outline" />
        </label>
        <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} className="inline-flex shrink-0 items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-sm text-body-md font-medium text-on-surface hover:bg-surface-container focus-visible:outline-2">
          <ListFilter size={16} />Filters{filterCount > 0 ? ` (${filterCount})` : ''}
        </button>
        {hasFilters && <button type="button" onClick={onClear} className="shrink-0 rounded px-xs py-sm text-body-md font-medium text-primary hover:underline">Clear</button>}
      </div>
    </div>
    {summary && <p className="mt-sm text-body-md text-on-surface-variant">{summary}</p>}
    {expanded && <div id={panelId} className="mt-md grid grid-cols-1 gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md sm:grid-cols-2 xl:grid-cols-3">{children}</div>}
  </section>
}

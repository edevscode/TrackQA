import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Clock,
  Equal,
  ListFilter,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchMyTasksData,
  prefetchMembersData,
  queryCache,
  type MyTasksItem,
} from '../lib/cache'
import type { IssuePriority, IssueStatus } from '../lib/database.types'

type TaskRow = MyTasksItem

const statusOptions: { value: IssueStatus | ''; label: string; dot: string }[] = [
  { value: '', label: 'All Statuses', dot: 'bg-outline' },
  { value: 'OPEN', label: 'Open', dot: 'bg-outline' },
  { value: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-primary' },
  { value: 'FOR_TESTING', label: 'For Testing', dot: 'bg-amber-500' },
  { value: 'PASSED', label: 'QA Passed', dot: 'bg-emerald-500' },
  { value: 'FAILED', label: 'QA Failed', dot: 'bg-rose-500' },
  { value: 'DONE', label: 'Closed', dot: 'bg-slate-400' },
]

const priorityOptions: {
  value: IssuePriority | ''
  label: string
  icon: typeof ChevronsUp
  color: string
}[] = [
  { value: '', label: 'All Priorities', icon: Equal, color: 'text-outline' },
  { value: 'CRITICAL', label: 'Critical', icon: ChevronsUp, color: 'text-rose-600' },
  { value: 'HIGH', label: 'High', icon: ChevronUp, color: 'text-amber-600' },
  { value: 'MEDIUM', label: 'Medium', icon: Equal, color: 'text-outline' },
  { value: 'LOW', label: 'Low', icon: ChevronDown, color: 'text-outline' },
]

type SortOption =
  | 'updated_desc'
  | 'updated_asc'
  | 'number_desc'
  | 'number_asc'
  | 'priority_desc'

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'updated_desc', label: 'Recently Updated' },
  { value: 'updated_asc', label: 'Oldest Updated' },
  { value: 'number_desc', label: 'Issue # (Highest)' },
  { value: 'number_asc', label: 'Issue # (Lowest)' },
  { value: 'priority_desc', label: 'Priority (Critical first)' },
]

const statusConfig: Record<
  IssueStatus,
  { label: string; dotClass: string; badgeClass: string }
> = {
  OPEN: {
    label: 'Open',
    dotClass: 'bg-outline',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
  IN_PROGRESS: {
    label: 'In Dev',
    dotClass: 'bg-primary',
    badgeClass: 'border-primary/30 bg-primary-fixed/30 text-primary',
  },
  FOR_TESTING: {
    label: 'For QA',
    dotClass: 'bg-amber-500 animate-pulse',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  PASSED: {
    label: 'QA Passed',
    dotClass: 'bg-emerald-500',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  FAILED: {
    label: 'QA Failed',
    dotClass: 'bg-rose-500',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  },
  DONE: {
    label: 'Closed',
    dotClass: 'bg-slate-400',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
}

const priorityConfig: Record<
  IssuePriority,
  {
    label: string
    icon: typeof ChevronsUp
    badgeClass: string
    iconClass: string
    weight: number
  }
> = {
  CRITICAL: {
    label: 'Critical',
    icon: ChevronsUp,
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
    iconClass: 'text-rose-600',
    weight: 4,
  },
  HIGH: {
    label: 'High',
    icon: ChevronUp,
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    iconClass: 'text-amber-600',
    weight: 3,
  },
  MEDIUM: {
    label: 'Medium',
    icon: Equal,
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
    iconClass: 'text-outline',
    weight: 2,
  },
  LOW: {
    label: 'Low',
    icon: ChevronDown,
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
    iconClass: 'text-outline',
    weight: 1,
  },
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function MyTasks() {
  const { user } = useAuth()
  const { currentProject } = useProject()

  const [tab, setTab] = useState<'assigned' | 'reported'>('assigned')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)

  // Filters and Sort State
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<IssueStatus | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | ''>('')
  const [sortBy, setSortBy] = useState<SortOption>('updated_desc')

  // Menu open dropdown state
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  const statusRef = useRef<HTMLDivElement>(null)
  const priorityRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  // Handle outside clicks to close dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false)
      }
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setPriorityMenuOpen(false)
      }
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadTasks = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject || !user) return

      const cacheKey = `mytasks:${currentProject.id}:${user.id}:${tab}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached) {
        setLoading(true)
      }

      try {
        const data = await fetchMyTasksData(currentProject.id, user.id, tab, {
          forceRefresh,
        })
        setTasks(data)
      } finally {
        setLoading(false)
      }

      // Prefetch Members page while on My Tasks
      prefetchMembersData(currentProject.id)
    },
    [currentProject, user, tab],
  )

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => loadTasks(true),
  })

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let list = [...tasks]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          `${currentProject?.key}-${t.issue_number}`.toLowerCase().includes(q) ||
          String(t.issue_number).includes(q),
      )
    }

    if (statusFilter) {
      list = list.filter((t) => t.status === statusFilter)
    }

    if (priorityFilter) {
      list = list.filter((t) => t.priority === priorityFilter)
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case 'updated_asc':
          return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        case 'number_desc':
          return b.issue_number - a.issue_number
        case 'number_asc':
          return a.issue_number - b.issue_number
        case 'priority_desc':
          return priorityConfig[b.priority].weight - priorityConfig[a.priority].weight
        case 'updated_desc':
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
    })

    return list
  }, [tasks, searchQuery, statusFilter, priorityFilter, sortBy, currentProject?.key])

  const hasActiveFilters =
    Boolean(searchQuery.trim()) || Boolean(statusFilter) || Boolean(priorityFilter)

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('')
    setPriorityFilter('')
  }

  const selectedStatusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label || 'Status'
  const selectedPriorityLabel =
    priorityOptions.find((o) => o.value === priorityFilter)?.label || 'Priority'
  const selectedSortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label || 'Sort'

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header & Filter Controls */}
          <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-xs">
                <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                  [{currentProject?.key ?? 'QA'}]
                </span>
                <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                  Operator Queue
                </h1>
              </div>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Tickets requiring active development, verification runs, or authored triage.
              </p>
            </div>

            {/* Filter and Sort Dropdowns */}
            <div className="flex flex-wrap items-center gap-xs sm:gap-sm">
              {/* Search Bar */}
              <div className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md focus-within:border-primary transition-colors">
                <Search size={15} className="text-outline" />
                <input
                  type="text"
                  placeholder="Search queue…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-32 bg-transparent text-body-md text-on-surface outline-none placeholder:text-outline sm:w-44"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    aria-label="Clear search"
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Status Filter Dropdown */}
              <div className="relative" ref={statusRef}>
                <button
                  type="button"
                  onClick={() => {
                    setStatusMenuOpen((v) => !v)
                    setPriorityMenuOpen(false)
                    setSortMenuOpen(false)
                  }}
                  className={`flex items-center gap-xs rounded-md border px-sm py-xs text-label-md font-semibold transition-colors ${
                    statusFilter
                      ? 'border-primary bg-primary-fixed/40 text-primary'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <ListFilter size={15} />
                  <span>
                    {statusFilter ? `Status: ${selectedStatusLabel}` : 'Status'}
                  </span>
                  <ChevronDown size={13} className="opacity-70" />
                </button>

                {statusMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-48 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-sm">
                    <div className="px-sm py-xs font-mono text-code-xs font-bold tracking-wider text-outline uppercase">
                      Filter Status
                    </div>
                    {statusOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setStatusFilter(opt.value)
                          setStatusMenuOpen(false)
                        }}
                        className={`flex w-full items-center justify-between px-sm py-xs text-body-md transition-colors ${
                          statusFilter === opt.value
                            ? 'bg-primary-fixed/30 font-semibold text-primary'
                            : 'text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        <span className="flex items-center gap-xs">
                          <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                          {opt.label}
                        </span>
                        {statusFilter === opt.value && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority Filter Dropdown */}
              <div className="relative" ref={priorityRef}>
                <button
                  type="button"
                  onClick={() => {
                    setPriorityMenuOpen((v) => !v)
                    setStatusMenuOpen(false)
                    setSortMenuOpen(false)
                  }}
                  className={`flex items-center gap-xs rounded-md border px-sm py-xs text-label-md font-semibold transition-colors ${
                    priorityFilter
                      ? 'border-primary bg-primary-fixed/40 text-primary'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <ChevronsUp size={15} />
                  <span>
                    {priorityFilter ? `Priority: ${selectedPriorityLabel}` : 'Priority'}
                  </span>
                  <ChevronDown size={13} className="opacity-70" />
                </button>

                {priorityMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-48 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-sm">
                    <div className="px-sm py-xs font-mono text-code-xs font-bold tracking-wider text-outline uppercase">
                      Filter Priority
                    </div>
                    {priorityOptions.map((opt) => {
                      const Icon = opt.icon
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setPriorityFilter(opt.value)
                            setPriorityMenuOpen(false)
                          }}
                          className={`flex w-full items-center justify-between px-sm py-xs text-body-md transition-colors ${
                            priorityFilter === opt.value
                              ? 'bg-primary-fixed/30 font-semibold text-primary'
                              : 'text-on-surface hover:bg-surface-container'
                          }`}
                        >
                          <span className="flex items-center gap-xs">
                            <Icon size={14} className={opt.color} />
                            {opt.label}
                          </span>
                          {priorityFilter === opt.value && <Check size={14} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Sort Dropdown */}
              <div className="relative" ref={sortRef}>
                <button
                  type="button"
                  onClick={() => {
                    setSortMenuOpen((v) => !v)
                    setStatusMenuOpen(false)
                    setPriorityMenuOpen(false)
                  }}
                  className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                >
                  <ArrowUpDown size={15} />
                  <span>Sort: {selectedSortLabel}</span>
                  <ChevronDown size={13} className="opacity-70" />
                </button>

                {sortMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-56 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-sm">
                    <div className="px-sm py-xs font-mono text-code-xs font-bold tracking-wider text-outline uppercase">
                      Sort Queue By
                    </div>
                    {sortOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSortBy(opt.value)
                          setSortMenuOpen(false)
                        }}
                        className={`flex w-full items-center justify-between px-sm py-xs text-body-md transition-colors ${
                          sortBy === opt.value
                            ? 'bg-primary-fixed/30 font-semibold text-primary'
                            : 'text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {sortBy === opt.value && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active Filter Chips Bar */}
          {hasActiveFilters && (
            <div className="mb-md flex flex-wrap items-center gap-xs">
              <span className="font-mono text-code-xs font-semibold text-outline uppercase">
                Active filters:
              </span>
              {searchQuery && (
                <span className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-xs py-0.5 font-mono text-code-xs text-on-surface">
                  Query: {searchQuery}
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="Remove search filter"
                    aria-label="Remove search filter"
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {statusFilter && (
                <span className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-xs py-0.5 font-mono text-code-xs text-on-surface">
                  Status: {selectedStatusLabel}
                  <button
                    type="button"
                    onClick={() => setStatusFilter('')}
                    title="Remove status filter"
                    aria-label="Remove status filter"
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {priorityFilter && (
                <span className="flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-xs py-0.5 font-mono text-code-xs text-on-surface">
                  Priority: {selectedPriorityLabel}
                  <button
                    type="button"
                    onClick={() => setPriorityFilter('')}
                    title="Remove priority filter"
                    aria-label="Remove priority filter"
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="font-mono text-code-xs font-semibold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Tabs: Assigned vs Reported */}
          <div className="mb-md flex items-center justify-between border-b border-outline-variant">
            <div className="flex items-center gap-md">
              <button
                type="button"
                onClick={() => setTab('assigned')}
                className={`-mb-px border-b-2 pb-xs text-body-md font-semibold transition-colors ${
                  tab === 'assigned'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Assigned to Me
              </button>
              <button
                type="button"
                onClick={() => setTab('reported')}
                className={`-mb-px border-b-2 pb-xs text-body-md font-semibold transition-colors ${
                  tab === 'reported'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Reported by Me
              </button>
            </div>

            <span className="pb-xs font-mono text-code-xs text-on-surface-variant">
              {filteredTasks.length} QUEUED {filteredTasks.length === 1 ? 'ITEM' : 'ITEMS'}
            </span>
          </div>

          {/* Task Cards Grid */}
          {loading ? (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-md text-on-surface-variant font-mono">
              Loading queue items…
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-xs rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center">
              <p className="text-headline-md font-semibold text-on-surface">
                {hasActiveFilters ? 'No matching queue items' : 'Queue is clear'}
              </p>
              <p className="w-full max-w-[28rem] text-body-md text-on-surface-variant">
                {hasActiveFilters
                  ? 'No tasks matched your current search and filter criteria.'
                  : tab === 'assigned'
                    ? 'No tickets currently assigned to your operator account in this project.'
                    : 'You have not authored any issues in this project yet.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-xs text-label-md font-semibold text-primary hover:underline"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task) => {
                const Priority = priorityConfig[task.priority]
                const Status = statusConfig[task.status]
                const PriorityIcon = Priority.icon
                const ticketAnchor = `[${currentProject?.key ?? 'TASK'}-${task.issue_number}]`

                return (
                  <Link
                    key={task.id}
                    to={`/issues/${task.id}`}
                    className="group flex flex-col justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-md hover:border-primary/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-xs">
                        <span className="font-mono text-code-xs font-bold text-on-surface group-hover:text-primary transition-colors">
                          {ticketAnchor}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-xs py-0.5 text-label-md font-semibold ${Priority.badgeClass}`}
                        >
                          <PriorityIcon size={12} className={Priority.iconClass} />
                          {Priority.label}
                        </span>
                      </div>

                      <h2 className="mt-xs line-clamp-2 text-body-lg font-semibold text-on-surface group-hover:text-primary transition-colors">
                        {task.title}
                      </h2>
                    </div>

                    <div className="mt-md flex items-center justify-between border-t border-outline-variant pt-xs">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-xs py-0.5 text-label-md font-semibold ${Status.badgeClass}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${Status.dotClass}`} />
                        {Status.label}
                      </span>
                      <span className="flex items-center gap-xs font-mono text-code-xs text-outline">
                        <Clock size={12} />
                        {timeAgo(task.updated_at)}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default MyTasks

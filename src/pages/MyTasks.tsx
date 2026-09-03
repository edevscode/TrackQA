import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Clock,
  Equal,
  Inbox,
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
  { value: 'OPEN', label: 'Open', dot: 'bg-rose-500' },
  { value: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-blue-500' },
  { value: 'FOR_TESTING', label: 'For Testing', dot: 'bg-purple-500' },
  { value: 'PASSED', label: 'Passed', dot: 'bg-emerald-500' },
  { value: 'FAILED', label: 'Failed', dot: 'bg-rose-500' },
  { value: 'DONE', label: 'Done', dot: 'bg-outline' },
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

const statusDot: Record<IssueStatus, string> = {
  OPEN: 'bg-rose-500',
  IN_PROGRESS: 'bg-blue-500',
  FOR_TESTING: 'bg-purple-500',
  PASSED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  DONE: 'bg-outline',
}

const priorityConfig: Record<
  IssuePriority,
  {
    icon: typeof ChevronsUp
    badge: string
    weight: number
  }
> = {
  CRITICAL: {
    icon: ChevronsUp,
    badge: 'bg-rose-50 text-rose-700',
    weight: 4,
  },
  HIGH: {
    icon: ChevronUp,
    badge: 'bg-amber-50 text-amber-700',
    weight: 3,
  },
  MEDIUM: {
    icon: Equal,
    badge: 'bg-surface-container text-on-surface-variant',
    weight: 2,
  },
  LOW: {
    icon: ChevronDown,
    badge: 'bg-surface-container text-on-surface-variant',
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

      <div className="flex flex-1 flex-col">
        <TopBar />

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-lg py-lg">
          {/* Header & Filter Controls */}
          <div className="mb-md flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-headline-xl font-bold text-on-surface">My Tasks</h1>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Manage and track all tasks assigned to you or created by you.
              </p>
            </div>

            {/* Filter and Sort Dropdowns */}
            <div className="flex flex-wrap items-center gap-sm">
              {/* Search Bar */}
              <div className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md">
                <Search size={16} className="text-outline" />
                <input
                  type="text"
                  placeholder="Filter by title or #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-36 bg-transparent text-on-surface outline-none placeholder:text-outline sm:w-48"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
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
                  className={`flex items-center gap-xs rounded-md border px-md py-sm text-body-md font-medium transition-colors ${
                    statusFilter
                      ? 'border-primary bg-primary-fixed/40 text-primary'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
                  }`}
                >
                  <ListFilter size={16} />
                  <span>
                    {statusFilter ? `Status: ${selectedStatusLabel}` : 'Status'}
                  </span>
                  <ChevronDown size={14} className="opacity-70" />
                </button>

                {statusMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-48 rounded-lg border border-outline-variant bg-surface-container-lowest py-xs shadow-raised animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-md py-xs text-[11px] font-bold tracking-wider text-outline uppercase">
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
                        className={`flex w-full items-center justify-between px-md py-sm text-body-md transition-colors ${
                          statusFilter === opt.value
                            ? 'bg-primary-fixed/30 font-semibold text-primary'
                            : 'text-on-surface hover:bg-surface-container-low'
                        }`}
                      >
                        <span className="flex items-center gap-sm">
                          <span className={`h-2 w-2 rounded-full ${opt.dot}`} />
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
                  className={`flex items-center gap-xs rounded-md border px-md py-sm text-body-md font-medium transition-colors ${
                    priorityFilter
                      ? 'border-primary bg-primary-fixed/40 text-primary'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
                  }`}
                >
                  <ChevronsUp size={16} />
                  <span>
                    {priorityFilter ? `Priority: ${selectedPriorityLabel}` : 'Priority'}
                  </span>
                  <ChevronDown size={14} className="opacity-70" />
                </button>

                {priorityMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-48 rounded-lg border border-outline-variant bg-surface-container-lowest py-xs shadow-raised animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-md py-xs text-[11px] font-bold tracking-wider text-outline uppercase">
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
                          className={`flex w-full items-center justify-between px-md py-sm text-body-md transition-colors ${
                            priorityFilter === opt.value
                              ? 'bg-primary-fixed/30 font-semibold text-primary'
                              : 'text-on-surface hover:bg-surface-container-low'
                          }`}
                        >
                          <span className="flex items-center gap-sm">
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
                  className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-medium text-on-surface hover:bg-surface-container-low"
                >
                  <ArrowUpDown size={16} />
                  <span>Sort: {selectedSortLabel}</span>
                  <ChevronDown size={14} className="opacity-70" />
                </button>

                {sortMenuOpen && (
                  <div className="absolute right-0 z-20 mt-xs w-56 rounded-lg border border-outline-variant bg-surface-container-lowest py-xs shadow-raised animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-md py-xs text-[11px] font-bold tracking-wider text-outline uppercase">
                      Sort Tasks By
                    </div>
                    {sortOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSortBy(opt.value)
                          setSortMenuOpen(false)
                        }}
                        className={`flex w-full items-center justify-between px-md py-sm text-body-md transition-colors ${
                          sortBy === opt.value
                            ? 'bg-primary-fixed/30 font-semibold text-primary'
                            : 'text-on-surface hover:bg-surface-container-low'
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
              <span className="text-label-md font-semibold text-outline">
                Active filters:
              </span>
              {searchQuery && (
                <span className="flex items-center gap-xs rounded-full border border-outline-variant bg-surface-container-low px-sm py-[2px] text-label-md text-on-surface">
                  Search: "{searchQuery}"
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {statusFilter && (
                <span className="flex items-center gap-xs rounded-full border border-outline-variant bg-surface-container-low px-sm py-[2px] text-label-md text-on-surface">
                  Status: {selectedStatusLabel}
                  <button
                    type="button"
                    onClick={() => setStatusFilter('')}
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {priorityFilter && (
                <span className="flex items-center gap-xs rounded-full border border-outline-variant bg-surface-container-low px-sm py-[2px] text-label-md text-on-surface">
                  Priority: {selectedPriorityLabel}
                  <button
                    type="button"
                    onClick={() => setPriorityFilter('')}
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className="text-label-md font-semibold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Tabs: Assigned vs Reported */}
          <div className="mb-lg flex items-center justify-between border-b border-outline-variant">
            <div className="flex items-center gap-lg">
              <button
                type="button"
                onClick={() => setTab('assigned')}
                className={`-mb-px border-b-2 pb-sm text-body-lg font-semibold transition-colors ${
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
                className={`-mb-px border-b-2 pb-sm text-body-lg font-semibold transition-colors ${
                  tab === 'reported'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Reported by Me
              </button>
            </div>

            <span className="pb-sm text-label-md text-on-surface-variant">
              Showing {filteredTasks.length} task{filteredTasks.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Task Cards Grid */}
          {loading ? (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-lg py-xl text-center text-body-lg text-on-surface-variant">
              Loading tasks…
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-xl text-center shadow-sm">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-low text-outline">
                <Inbox size={32} />
              </div>
              <div className="flex flex-col items-center gap-xs">
                <h3 className="text-headline-md font-bold text-on-surface">
                  {hasActiveFilters ? 'No matching tasks' : 'No tasks found'}
                </h3>
                <p className="max-w-[480px] text-body-lg text-on-surface-variant leading-relaxed">
                  {hasActiveFilters
                    ? 'No tasks matched your current search and filter criteria. Try resetting or adjusting your filters.'
                    : tab === 'assigned'
                      ? 'Nothing assigned to you right now in this project.'
                      : "You haven't reported any issues yet in this project."}
                </p>
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task) => {
                const Priority = priorityConfig[task.priority]
                return (
                  <Link
                    key={task.id}
                    to={`/issues/${task.id}`}
                    className="group flex flex-col justify-between rounded-xl border border-outline-variant bg-surface-container-lowest p-md shadow-xs transition-all hover:border-primary/40 hover:bg-surface-container-low hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-sm">
                        <span className="font-mono text-code-sm font-semibold text-on-surface-variant group-hover:text-primary transition-colors">
                          {currentProject?.key}-{task.issue_number}
                        </span>
                        <span
                          className={`flex items-center gap-xs rounded-full px-sm py-[2px] text-label-md font-semibold ${Priority.badge}`}
                        >
                          <Priority.icon size={12} />
                          {task.priority}
                        </span>
                      </div>

                      <h2 className="mt-sm line-clamp-2 text-headline-md font-semibold text-on-surface group-hover:text-primary transition-colors">
                        {task.title}
                      </h2>
                    </div>

                    <div className="mt-md flex items-center justify-between border-t border-outline-variant/60 pt-sm text-body-md text-on-surface-variant">
                      <span className="flex items-center gap-xs text-on-surface">
                        <span className={`h-2 w-2 rounded-full ${statusDot[task.status]}`} />
                        {task.status.replace('_', ' ')}
                      </span>
                      <span className="flex items-center gap-xs text-[12px]">
                        <Clock size={13} />
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

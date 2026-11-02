import DeadlineSummary from '../components/DeadlineSummary'
import IssueListControls, { FilterSelect } from '../components/IssueListControls'
import { matchesLifecycle, workGroup, workGroupOrder, workGroups, type IssueLifecycle } from '../lib/issueWork'
import { useIssueQueue } from '../hooks/useIssueQueue'
import { deadlineState, compareResolutionDates, comparePendingDeadlines, type DeadlineFilter } from '../lib/deadlines'
import { useDeadlineClock } from '../hooks/useDeadlineClock'
import LoadError from '../components/LoadError'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Clock,
  Equal,
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
  | 'next_deadline_asc'
  | 'deadline_asc'
  | 'updated_desc'
  | 'updated_asc'
  | 'number_desc'
  | 'number_asc'
  | 'priority_desc'

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'next_deadline_asc', label: 'Nearest pending target' },
  { value: 'deadline_asc', label: 'Nearest resolution deadline' },
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const { user } = useAuth()
  const { currentProject, currentRole } = useProject()
  const { state: queue, update, origin } = useIssueQueue('/my-tasks', currentProject?.id ?? '')
  const { view: lifecycle, scope: tab, status: statusFilter, priority: priorityFilter,
    q: searchQuery, deadline: deadlineFilter, page } = queue
  const sortBy = queue.order as SortOption
  const minute = useDeadlineClock()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const requestVersion = useRef(0)
  const loadedScope = useRef('')
  const setPage = (value: number) => update({ page: value })
  const setSearchQuery = (value: string) => update({ q: value }, true)
  const setStatusFilter = (value: IssueStatus | '') => update({ status: value })
  const setPriorityFilter = (value: IssuePriority | '') => update({ priority: value })
  const setSortBy = (value: SortOption) => update({ order: value })
  const setTab = (value: 'mine' | 'assigned' | 'reported') => update({ scope: value })
  const setLifecycle = (value: IssueLifecycle) => {
    update({ view: value, status: '', deadline: '', ...(value === 'completed' ? { order: 'updated_desc' } : {}) })
  }

  const loadTasks = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject || !user) return

      const cacheKey = `mytasks:${currentProject.id}:${user.id}:${tab}:${lifecycle}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached) {
        setLoading(true)
      }

      setLoadError(null)
      const version = ++requestVersion.current
      try {
        const data = await fetchMyTasksData(currentProject.id, user.id, tab, {
          forceRefresh,
          lifecycle,
        })
        if (version !== requestVersion.current) return
        loadedScope.current = cacheKey
        setTasks(data)
      } catch {
        if (version === requestVersion.current) setLoadError('Unable to load data. Check your connection and retry.')
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }

      // Prefetch Members page while on My Tasks
      prefetchMembersData(currentProject.id)
    },
    [currentProject, user, tab, lifecycle],
  )

  useEffect(() => {
    loadTasks()
  }, [loadTasks, minute])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => loadTasks(true),
  })

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let list = tasks.filter((task) => matchesLifecycle(task.status, lifecycle)
      && (tab === 'mine' ? task.assignee_id === user?.id || task.reporter_id === user?.id : tab === 'assigned' ? task.assignee_id === user?.id : task.reporter_id === user?.id))

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

    if (deadlineFilter) {
      list = list.filter((task) => {
        const state = deadlineState(task, new Date(minute * 60_000 + 1))
        return deadlineFilter === 'upcoming' ? state.dueSoon : deadlineFilter === 'overdue' ? state.overdue : task.status !== 'DONE' && state.missedStage
      })
    }
    list.sort((a, b) => {
      const groupOrder = workGroupOrder(a, user?.id ?? '', currentRole) - workGroupOrder(b, user?.id ?? '', currentRole)
      if (groupOrder) return groupOrder
      switch (sortBy) {
        case 'next_deadline_asc': return comparePendingDeadlines(a, b) || b.issue_number - a.issue_number
        case 'deadline_asc': return compareResolutionDates(a, b) || b.issue_number - a.issue_number
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
  }, [tasks, searchQuery, statusFilter, priorityFilter, sortBy, currentProject?.key, deadlineFilter, minute, lifecycle, tab, user?.id, currentRole])

  const pageSize = 12
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  useEffect(() => {
    if (!loading && !loadError && page > totalPages
      && loadedScope.current === `mytasks:${currentProject?.id}:${user?.id}:${tab}:${lifecycle}`) {
      update({ page: totalPages }, true)
    }
  }, [loading, loadError, page, totalPages, currentProject?.id, user?.id, tab, lifecycle, update])
  const pageTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const groupedTasks = workGroups.map((group) => ({ ...group,
    tasks: pageTasks.filter((task) => workGroup(task, user?.id ?? '', currentRole) === group.key),
  })).filter((group) => group.tasks.length)

  const hasActiveFilters =
    Boolean(searchQuery.trim()) || Boolean(statusFilter) || Boolean(priorityFilter) || Boolean(deadlineFilter) || tab !== 'mine'

  const clearFilters = () => {
    update({ q: '', priority: '', status: '', deadline: '', scope: 'mine', order: 'updated_desc' })
  }

  const selectedStatusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label || 'Status'
  const selectedPriorityLabel =
    priorityOptions.find((o) => o.value === priorityFilter)?.label || 'Priority'

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          <LoadError message={loadError} onRetry={() => void loadTasks(true)} />
          {/* Header & Filter Controls */}
          <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-xs">
                <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                  [{currentProject?.key ?? 'QA'}]
                </span>
                <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                  My Tasks
                </h1>
              </div>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Your current work and completed history.
              </p>
            </div>

            <span className="text-body-md text-on-surface-variant">{filteredTasks.length} {lifecycle === 'completed' ? 'completed' : lifecycle === 'active' ? 'active' : 'total'} issues</span>
          </div>

          <IssueListControls lifecycle={lifecycle} onLifecycleChange={setLifecycle} search={searchQuery} onSearchChange={setSearchQuery}
            filterCount={[statusFilter, priorityFilter, deadlineFilter, tab !== 'mine' ? tab : ''].filter(Boolean).length}
            summary={[
              tab === 'assigned' ? 'Assigned to me' : tab === 'reported' ? 'Reported by me' : '',
              statusFilter ? selectedStatusLabel : '', priorityFilter ? `${selectedPriorityLabel} priority` : '',
              deadlineFilter === 'upcoming' ? 'Due soon' : deadlineFilter === 'overdue' ? 'Resolution overdue' : deadlineFilter === 'missed' ? 'Missed stage targets' : '',
            ].filter(Boolean).join(' / ')} hasFilters={hasActiveFilters} onClear={clearFilters}>
            <FilterSelect label="Responsibility" value={tab} onChange={(value) => setTab(value as 'mine' | 'assigned' | 'reported')}>
              <option value="mine">My work</option><option value="assigned">Assigned to me</option><option value="reported">Reported by me</option>
            </FilterSelect>
            {lifecycle !== 'completed' && <FilterSelect label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as IssueStatus | '')}>
              {statusOptions.filter((option) => !option.value || matchesLifecycle(option.value, lifecycle)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>}
            <FilterSelect label="Priority" value={priorityFilter} onChange={(value) => setPriorityFilter(value as IssuePriority | '')}>
              {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            {lifecycle !== 'completed' && <FilterSelect label="Deadline" value={deadlineFilter} onChange={(value) => update({ deadline: value as DeadlineFilter, ...(value === 'upcoming' ? { order: 'next_deadline_asc' } : {}) })}>
              <option value="">Any deadline</option><option value="upcoming">Due soon (next 7 days)</option><option value="overdue">Resolution overdue</option><option value="missed">Missed stage targets</option>
            </FilterSelect>}
            <FilterSelect label="Sort by" value={sortBy} onChange={(value) => setSortBy(value as SortOption)}>
              {sortOptions.filter((option) => lifecycle !== 'completed' || (option.value !== 'deadline_asc' && option.value !== 'next_deadline_asc')).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
          </IssueListControls>

          {/* Task Cards Grid */}
          {loading ? (
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-md text-on-surface-variant font-mono">
              Loading queue items…
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center gap-xs rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center">
              <p className="text-headline-md font-semibold text-on-surface">
                {hasActiveFilters ? 'No matching issues' : lifecycle === 'completed' ? 'No completed issues yet' : lifecycle === 'all' ? 'No related issues yet' : 'No active work in this view'}
              </p>
              <p className="w-full max-w-[28rem] text-body-md text-on-surface-variant">
                {hasActiveFilters
                  ? 'No tasks matched your current search and filter criteria.'
                  : lifecycle === 'completed' ? 'Closed issues will appear here with their history.' : 'Completed history is available in Completed. Use All to see the full history for this relationship.'}
              </p>

            </div>
          ) : (
            <div className="space-y-lg">
              {groupedTasks.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <h2 className="mb-sm text-headline-md font-semibold">{group.label}</h2>
                  <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
                    {group.tasks.map((task) => {
                      const Priority = priorityConfig[task.priority]
                      const Status = statusConfig[task.status]
                      const PriorityIcon = Priority.icon
                      const ticketAnchor = `[${currentProject?.key ?? 'TASK'}-${task.issue_number}]`

                      return (
                        <Link
                          key={task.id}
                          to={`/issues/${task.id}`}
                          state={{ queueReturn: origin }}
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

                            <h3 className="mt-xs line-clamp-2 text-body-lg font-semibold text-on-surface group-hover:text-primary transition-colors">
                              {task.title}
                            </h3>
                            {task.deadline_mode !== 'none' && <DeadlineSummary issue={task} compact />}
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
                </section>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant pt-md text-body-md">
                <span>Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredTasks.length)} of {filteredTasks.length}. Groups reflect this page.</span>
                {totalPages > 1 && <div className="flex items-center gap-sm">
                  <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded border border-outline-variant px-sm py-xs disabled:opacity-40">Previous</button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="rounded border border-outline-variant px-sm py-xs disabled:opacity-40">Next</button>
                </div>}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default MyTasks

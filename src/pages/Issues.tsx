import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  Equal,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchIssuesData,
  prefetchMyTasksData,
  queryCache,
  type IssueListItem,
} from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { IssuePriority, IssueStatus } from '../lib/database.types'

const PAGE_SIZE = 12

const priorityConfig: Record<
  IssuePriority,
  { label: string; icon: typeof ChevronsUp; className: string }
> = {
  CRITICAL: { label: 'Critical', icon: ChevronsUp, className: 'text-rose-600' },
  HIGH: { label: 'High', icon: ChevronUp, className: 'text-amber-600' },
  MEDIUM: { label: 'Medium', icon: Equal, className: 'text-slate-500' },
  LOW: { label: 'Low', icon: ChevronDown, className: 'text-slate-400' },
}

const statusConfig: Record<
  IssueStatus,
  { label: string; badge: string; dot: string }
> = {
  OPEN: {
    label: 'Open',
    badge: 'bg-surface-container border border-outline-variant text-on-surface-variant',
    dot: 'bg-slate-400',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    badge: 'bg-sky-50 border border-sky-200 text-sky-800',
    dot: 'bg-sky-500',
  },
  FOR_TESTING: {
    label: 'For Testing',
    badge: 'bg-indigo-50 border border-indigo-200 text-indigo-900 font-semibold',
    dot: 'bg-indigo-600',
  },
  PASSED: {
    label: 'Passed',
    badge: 'bg-emerald-50 border border-emerald-200 text-emerald-800',
    dot: 'bg-emerald-600',
  },
  FAILED: {
    label: 'Failed',
    badge: 'bg-rose-50 border border-rose-200 text-rose-800 font-semibold',
    dot: 'bg-rose-600',
  },
  DONE: {
    label: 'Done',
    badge: 'bg-surface-container border border-outline-variant text-on-surface-variant',
    dot: 'bg-slate-500',
  },
}

type Member = { user_id: string; full_name: string | null }
type IssueRow = IssueListItem

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function Issues() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentProject } = useProject()

  const [issues, setIssues] = useState<IssueRow[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<IssueStatus | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | ''>('')
  const [assigneeFilter, setAssigneeFilter] = useState('')

  useEffect(() => {
    if (!currentProject) return
    supabase
      .from('project_members')
      .select('user_id, profiles(full_name)')
      .eq('project_id', currentProject.id)
      .then(({ data }) => {
        setMembers(
          (data ?? []).map((m) => ({
            user_id: m.user_id,
            full_name: (m as unknown as { profiles: { full_name: string | null } }).profiles
              ?.full_name,
          })),
        )
      })
  }, [currentProject])

  const loadIssues = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject) return

      const params = {
        page,
        pageSize: PAGE_SIZE,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        search,
      }

      const cacheKey = `issues:${currentProject.id}:${JSON.stringify({
        page,
        pageSize: PAGE_SIZE,
        statusFilter: statusFilter || '',
        priorityFilter: priorityFilter || '',
        assigneeFilter: assigneeFilter || '',
        search: search.trim(),
      })}`

      const hasCached = !forceRefresh && Boolean(queryCache.get(cacheKey))
      if (forceRefresh) {
        setRefreshing(true)
      } else if (!hasCached) {
        setLoading(true)
      }

      try {
        const [res] = await Promise.all([
          fetchIssuesData(currentProject.id, params, { forceRefresh }),
          forceRefresh ? new Promise((r) => setTimeout(r, 500)) : Promise.resolve(),
        ])
        setIssues(res.issues)
        setTotalCount(res.totalCount)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }

      if (user?.id) {
        prefetchMyTasksData(currentProject.id, user.id)
      }
    },
    [currentProject, user, page, statusFilter, priorityFilter, assigneeFilter, search],
  )

  useEffect(() => {
    loadIssues()
  }, [loadIssues])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => loadIssues(true),
  })

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('')
    setPriorityFilter('')
    setAssigneeFilter('')
    setPage(1)
  }

  const hasFilters = Boolean(search || statusFilter || priorityFilter || assigneeFilter)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, totalCount)

  const pageNumbers = useMemo(() => {
    const nums = new Set<number>([1, totalPages, page, page - 1, page + 1])
    return [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  }, [page, totalPages])

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header Bar */}
          <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-xs">
                <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                  [{currentProject?.key ?? 'QA'}]
                </span>
                <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                  Issue Backlog
                </h1>
              </div>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Defect tracking, verification queues, and sprint resolution status.
              </p>
            </div>

            <div className="flex items-center gap-xs sm:gap-sm">
              <button
                type="button"
                onClick={() => loadIssues(true)}
                disabled={refreshing}
                title="Refresh issues list"
                aria-label="Refresh issues list"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-outline hover:bg-surface-container hover:text-primary active:scale-95 disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  className={refreshing ? 'animate-spin text-primary' : ''}
                />
              </button>
              <button
                type="button"
                onClick={() => navigate('/issues/new')}
                className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
              >
                <Plus size={16} />
                <span>Report Issue</span>
              </button>
            </div>
          </div>

          {/* Integrated Workbench Filter Bar */}
          <div className="mb-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <div className="flex flex-wrap items-center gap-sm">
              {/* Search Box */}
              <div className="flex min-w-[240px] flex-1 items-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <Search className="text-outline shrink-0" size={16} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Filter by issue title or keyword..."
                  className="flex-1 bg-transparent text-body-md text-on-surface outline-none placeholder:text-outline"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setPage(1)
                    }}
                    className="text-outline hover:text-on-surface"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Status Select */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as IssueStatus | '')
                    setPage(1)
                  }}
                  className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-xs pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low transition-colors"
                >
                  <option value="">All Statuses</option>
                  {(Object.keys(statusConfig) as IssueStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {statusConfig[s].label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                  size={14}
                />
              </div>

              {/* Priority Select */}
              <div className="relative">
                <select
                  value={priorityFilter}
                  onChange={(e) => {
                    setPriorityFilter(e.target.value as IssuePriority | '')
                    setPage(1)
                  }}
                  className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-xs pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low transition-colors"
                >
                  <option value="">All Priorities</option>
                  {(Object.keys(priorityConfig) as IssuePriority[]).map((p) => (
                    <option key={p} value={p}>
                      {priorityConfig[p].label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                  size={14}
                />
              </div>

              {/* Assignee Select */}
              <div className="relative">
                <select
                  value={assigneeFilter}
                  onChange={(e) => {
                    setAssigneeFilter(e.target.value)
                    setPage(1)
                  }}
                  className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-xs pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low transition-colors"
                >
                  <option value="">All Assignees</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name ?? 'Unnamed'}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                  size={14}
                />
              </div>

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                >
                  <ListFilter size={14} />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
            {loading ? (
              <div className="p-xl text-center text-body-lg text-on-surface-variant">
                Loading issue backlog…
              </div>
            ) : issues.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center p-xl text-center">
                <p className="text-body-lg text-on-surface-variant">
                  {hasFilters
                    ? 'No issues match the selected filter criteria.'
                    : 'No issues logged for this project yet.'}
                </p>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-sm inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-semibold text-primary hover:bg-surface-container transition-colors"
                  >
                    Clear Filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate('/issues/new')}
                    className="mt-sm inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
                  >
                    <Plus size={16} />
                    <span>Report First Issue</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Mobile Scannable List */}
                <div className="divide-y divide-outline-variant md:hidden">
                  {issues.map((issue) => {
                    const status = statusConfig[issue.status]
                    const priority = priorityConfig[issue.priority]
                    const PriorityIcon = priority.icon
                    const resolved = issue.status === 'PASSED' || issue.status === 'DONE'

                    return (
                      <div
                        key={issue.id}
                        onClick={() => navigate(`/issues/${issue.id}`)}
                        className={`cursor-pointer p-md transition-colors hover:bg-surface-container-low ${
                          issue.status === 'FAILED' ? 'bg-rose-50/20' : ''
                        }`}
                      >
                        <div className="flex items-start gap-sm">
                          <Avatar
                            name={issue.assignee?.full_name}
                            avatarUrl={issue.assignee?.avatar_url}
                            size={32}
                            className="shrink-0 border border-outline-variant"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-xs">
                              <span
                                className={`font-mono text-code-sm font-semibold ${
                                  resolved ? 'text-outline line-through' : 'text-primary'
                                }`}
                              >
                                {currentProject?.key}-{issue.issue_number}
                              </span>
                              <PriorityIcon size={14} className={priority.className} />
                            </div>
                            <p
                              className={`mt-xs truncate text-body-md font-medium ${
                                resolved ? 'text-on-surface-variant line-through' : 'text-on-surface'
                              }`}
                            >
                              {issue.title}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 inline-flex items-center gap-xs rounded-full px-sm py-[2px] text-label-md ${status.badge}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </div>
                        <div className="mt-sm flex items-center justify-between text-label-md text-on-surface-variant">
                          <span>{issue.assignee?.full_name ?? 'Unassigned'}</span>
                          <span>{timeAgo(issue.created_at)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop High-Density Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-outline-variant bg-surface-container-low text-label-md font-semibold uppercase tracking-wider text-on-surface-variant">
                        <th className="px-lg py-sm">ID</th>
                        <th className="px-lg py-sm">Summary</th>
                        <th className="px-lg py-sm">Status</th>
                        <th className="px-lg py-sm">Priority</th>
                        <th className="px-lg py-sm">Assignee</th>
                        <th className="px-lg py-sm">Reporter</th>
                        <th className="px-lg py-sm text-right">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {issues.map((issue) => {
                        const status = statusConfig[issue.status]
                        const priority = priorityConfig[issue.priority]
                        const PriorityIcon = priority.icon
                        const resolved = issue.status === 'PASSED' || issue.status === 'DONE'

                        return (
                          <tr
                            key={issue.id}
                            onClick={() => navigate(`/issues/${issue.id}`)}
                            className={`cursor-pointer transition-colors hover:bg-surface-container-low group ${
                              issue.status === 'FAILED' ? 'bg-rose-50/15' : ''
                            }`}
                          >
                            <td className="whitespace-nowrap px-lg py-md">
                              <span
                                className={`font-mono text-code-sm font-semibold ${
                                  resolved
                                    ? 'text-outline line-through'
                                    : 'text-primary group-hover:underline'
                                }`}
                              >
                                {currentProject?.key}-{issue.issue_number}
                              </span>
                            </td>
                            <td className="max-w-[340px] px-lg py-md">
                              <span
                                className={`block truncate text-body-md font-medium ${
                                  resolved
                                    ? 'text-on-surface-variant line-through'
                                    : 'text-on-surface group-hover:text-primary'
                                } transition-colors`}
                              >
                                {issue.title}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-lg py-md">
                              <span
                                className={`inline-flex items-center gap-xs rounded-full px-sm py-[2px] text-label-md ${status.badge}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                                {status.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-lg py-md">
                              <span
                                className={`inline-flex items-center gap-xs text-body-md font-medium ${priority.className}`}
                              >
                                <PriorityIcon size={16} />
                                {priority.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-lg py-md">
                              <div className="flex items-center gap-xs">
                                <Avatar
                                  name={issue.assignee?.full_name}
                                  avatarUrl={issue.assignee?.avatar_url}
                                  size={24}
                                  className="border border-outline-variant"
                                />
                                <span className="max-w-[120px] truncate text-body-md text-on-surface-variant">
                                  {issue.assignee?.full_name ?? 'Unassigned'}
                                </span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-lg py-md text-body-md text-on-surface-variant">
                              {issue.reporter?.full_name ?? '—'}
                            </td>
                            <td className="whitespace-nowrap px-lg py-md text-right text-body-md text-on-surface-variant">
                              {timeAgo(issue.created_at)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Pagination Controls */}
            {totalCount > 0 && (
              <div className="flex flex-col gap-sm border-t border-outline-variant px-lg py-md sm:flex-row sm:items-center sm:justify-between bg-surface-container-low">
                <p className="text-body-md text-on-surface-variant">
                  Showing <strong className="font-mono text-on-surface">{rangeStart}</strong> to{' '}
                  <strong className="font-mono text-on-surface">{rangeEnd}</strong> of{' '}
                  <strong className="font-mono text-on-surface">{totalCount}</strong> issues
                </p>
                <div className="flex items-center gap-xs">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-40"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {pageNumbers.map((n, i) => (
                    <span key={n} className="flex items-center gap-xs">
                      {i > 0 && pageNumbers[i - 1] !== n - 1 && (
                        <span className="px-xs text-on-surface-variant">…</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setPage(n)}
                        className={`flex h-8 min-w-8 items-center justify-center rounded-md px-sm text-body-md font-semibold transition-colors ${
                          n === page
                            ? 'bg-primary text-on-primary'
                            : 'border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        {n}
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-40"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default Issues

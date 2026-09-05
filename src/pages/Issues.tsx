import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  Equal,
  ListFilter,
  Plus,
  Search,
  User,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
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

const PAGE_SIZE = 10

const priorityConfig: Record<IssuePriority, { icon: typeof ChevronsUp; className: string }> = {
  CRITICAL: { icon: ChevronsUp, className: 'text-rose-600' },
  HIGH: { icon: ChevronUp, className: 'text-amber-600' },
  MEDIUM: { icon: Equal, className: 'text-outline' },
  LOW: { icon: ChevronDown, className: 'text-outline' },
}

const statusConfig: Record<IssueStatus, string> = {
  OPEN: 'border border-outline-variant bg-surface-container-lowest text-on-surface',
  IN_PROGRESS: 'border border-blue-200 bg-blue-50 text-blue-700',
  FOR_TESTING: 'border border-purple-200 bg-purple-50 text-purple-700',
  FAILED: 'border border-rose-200 bg-rose-50 text-rose-700',
  PASSED: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  DONE: 'border border-outline-variant bg-surface-container text-on-surface-variant',
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

      const hasCached = !forceRefresh && queryCache.get(cacheKey)
      if (!hasCached) {
        setLoading(true)
      }

      try {
        const res = await fetchIssuesData(currentProject.id, params, {
          forceRefresh,
        })
        setIssues(res.issues)
        setTotalCount(res.totalCount)
      } finally {
        setLoading(false)
      }

      // Prefetch My Tasks while on Issues page
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

  const hasFilters = !!(search || statusFilter || priorityFilter || assigneeFilter)

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

      <div className="flex-1 py-lg">
        <div className="mb-lg flex items-start justify-between px-lg">
          <div>
            <h1 className="text-headline-xl font-bold text-on-surface">
              Issues
            </h1>
            <p className="mt-xs text-body-lg text-on-surface-variant">
              Manage, track, and resolve project bugs and tasks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/issues/new')}
            className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container"
          >
            <Plus size={16} />
            Report Issue
          </button>
        </div>

        <div className="mb-md flex flex-wrap items-center gap-sm border-y border-outline-variant px-lg py-md">
            <div className="flex min-w-[280px] flex-1 items-center gap-sm rounded-md border border-outline-variant px-md py-sm">
              <Search className="text-outline" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search issues by title..."
                className="flex-1 bg-transparent text-body-lg text-on-surface outline-none placeholder:text-outline"
              />
            </div>

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as IssueStatus | '')
                  setPage(1)
                }}
                className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low"
              >
                <option value="">Status</option>
                {(Object.keys(statusConfig) as IssueStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={16}
              />
            </div>

            <div className="relative">
              <select
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value as IssuePriority | '')
                  setPage(1)
                }}
                className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low"
              >
                <option value="">Priority</option>
                {(Object.keys(priorityConfig) as IssuePriority[]).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={16}
              />
            </div>

            <div className="relative">
              <select
                value={assigneeFilter}
                onChange={(e) => {
                  setAssigneeFilter(e.target.value)
                  setPage(1)
                }}
                className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low"
              >
                <option value="">Assignee</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name ?? 'Unnamed'}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={16}
              />
            </div>

            {hasFilters && (
              <>
                <div className="h-6 w-px bg-outline-variant" />
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
                >
                  <ListFilter size={16} />
                  Clear Filters
                </button>
              </>
            )}
          </div>

          {loading ? (
            <div className="mx-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-lg text-on-surface-variant">
              Loading…
            </div>
          ) : issues.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center px-lg text-center text-body-lg text-on-surface-variant">
              No issues match these filters.
            </div>
          ) : (
            <div className="border-t border-outline-variant">
              <div className="hidden border-b border-outline-variant px-lg py-sm text-label-md font-semibold uppercase tracking-wide text-on-surface-variant lg:grid lg:grid-cols-[64px_minmax(0,2fr)_48px_minmax(88px,0.9fr)_minmax(96px,1fr)_minmax(96px,1fr)_84px] lg:items-center lg:gap-md">
                <span className="min-w-0 truncate">ID</span>
                <span className="min-w-0 truncate">Title</span>
                <span className="min-w-0 truncate">Priority</span>
                <span className="min-w-0 truncate">Status</span>
                <span className="min-w-0 truncate">Assignee</span>
                <span className="min-w-0 truncate">Reporter</span>
                <span className="min-w-0 truncate text-right">Updated</span>
              </div>

              {issues.map((issue) => {
                const Priority = priorityConfig[issue.priority]
                const resolved = issue.status === 'PASSED' || issue.status === 'DONE'
                return (
                  <div key={issue.id}>
                    {/* Mobile card */}
                    <div
                      onClick={() => navigate(`/issues/${issue.id}`)}
                      className={`cursor-pointer border-b border-outline-variant p-lg hover:bg-surface-container-low lg:hidden ${
                        issue.status === 'FAILED' ? 'bg-rose-50/40' : ''
                      }`}
                    >
                      <div className="flex items-start gap-sm">
                        {issue.assignee?.full_name ? (
                          <Avatar
                            name={issue.assignee.full_name}
                            avatarUrl={issue.assignee.avatar_url}
                            size={36}
                            className="shrink-0"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                            <User size={16} />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-xs text-label-md text-on-surface-variant">
                            <span
                              className={`font-mono ${resolved ? 'text-outline line-through' : ''}`}
                            >
                              {currentProject?.key}-{issue.issue_number}
                            </span>
                            <Priority.icon className={Priority.className} size={14} />
                          </div>
                          <p
                            className={`mt-xs text-body-md font-semibold ${
                              resolved ? 'text-on-surface-variant line-through' : 'text-on-surface'
                            }`}
                          >
                            {issue.title}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-sm px-sm py-[2px] text-label-md font-semibold uppercase ${statusConfig[issue.status]}`}
                        >
                          {issue.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="mt-sm flex items-center justify-between gap-sm text-label-md text-on-surface-variant">
                        <span className="truncate">
                          {issue.assignee?.full_name ?? 'Unassigned'}
                          {issue.reporter?.full_name && ` · Reported by ${issue.reporter.full_name}`}
                        </span>
                        <span className="shrink-0">{timeAgo(issue.created_at)}</span>
                      </div>
                    </div>

                    {/* Desktop row */}
                    <div
                      onClick={() => navigate(`/issues/${issue.id}`)}
                      className={`hidden cursor-pointer border-b border-outline-variant px-lg py-md hover:bg-surface-container-low lg:grid lg:grid-cols-[64px_minmax(0,2fr)_48px_minmax(88px,0.9fr)_minmax(96px,1fr)_minmax(96px,1fr)_84px] lg:items-center lg:gap-md ${
                        issue.status === 'FAILED' ? 'bg-rose-50/40' : ''
                      }`}
                    >
                      <span
                        className={`min-w-0 font-mono text-body-md ${
                          resolved ? 'text-outline line-through' : 'text-on-surface-variant'
                        }`}
                      >
                        {currentProject?.key}-{issue.issue_number}
                      </span>
                      <span
                        className={`min-w-0 text-body-md xl:text-body-lg ${
                          resolved ? 'text-on-surface-variant line-through' : 'text-on-surface'
                        }`}
                      >
                        {issue.title}
                      </span>
                      <Priority.icon className={`${Priority.className} shrink-0`} size={18} />
                      <span
                        className={`w-fit min-w-0 rounded-sm px-sm py-[2px] text-label-md font-semibold uppercase ${statusConfig[issue.status]}`}
                      >
                        {issue.status.replace('_', ' ')}
                      </span>
                      <div className="flex min-w-0 items-center gap-sm">
                        {issue.assignee?.full_name ? (
                          <>
                            <Avatar
                              name={issue.assignee.full_name}
                              avatarUrl={issue.assignee.avatar_url}
                              size={28}
                              className="shrink-0"
                            />
                            <span className="min-w-0 text-body-md text-on-surface">
                              {issue.assignee.full_name}
                            </span>
                          </>
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                            <User size={14} />
                          </div>
                        )}
                      </div>
                      <span className="min-w-0 text-body-md text-on-surface-variant">
                        {issue.reporter?.full_name ?? '—'}
                      </span>
                      <span className="min-w-0 text-right text-body-md text-on-surface-variant">
                        {timeAgo(issue.created_at)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-md flex items-center justify-between px-lg">
            <p className="text-body-md text-on-surface-variant">
              {totalCount === 0
                ? 'No issues'
                : `Showing ${rangeStart} to ${rangeEnd} of ${totalCount} issues`}
            </p>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              {pageNumbers.map((n, i) => (
                <span key={n} className="flex items-center gap-xs">
                  {i > 0 && pageNumbers[i - 1] !== n - 1 && (
                    <span className="px-xs text-on-surface-variant">...</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPage(n)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md text-body-md font-medium ${
                      n === page
                        ? 'bg-primary text-on-primary'
                        : 'text-on-surface hover:bg-surface-container-low'
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
                className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
      </div>
    </div>
  )
}

export default Issues

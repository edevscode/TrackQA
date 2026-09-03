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

      <div className="flex-1 px-lg py-lg">
        <div className="mb-lg flex items-start justify-between">
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

        <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
          <div className="flex flex-wrap items-center gap-sm border-b border-outline-variant p-md">
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

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-label-md uppercase tracking-wide text-on-surface-variant">
                  <th className="px-lg py-sm font-semibold">ID</th>
                  <th className="px-lg py-sm font-semibold">Title</th>
                  <th className="px-lg py-sm font-semibold">Priority</th>
                  <th className="px-lg py-sm font-semibold">Status</th>
                  <th className="px-lg py-sm font-semibold">Assignee</th>
                  <th className="px-lg py-sm font-semibold">Reporter</th>
                  <th className="px-lg py-sm font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-lg py-xl text-center text-body-lg text-on-surface-variant">
                      Loading…
                    </td>
                  </tr>
                ) : issues.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-lg py-xl text-center text-body-lg text-on-surface-variant">
                      No issues match these filters.
                    </td>
                  </tr>
                ) : (
                  issues.map((issue) => {
                    const Priority = priorityConfig[issue.priority]
                    const resolved = issue.status === 'PASSED' || issue.status === 'DONE'
                    return (
                      <tr
                        key={issue.id}
                        onClick={() => navigate(`/issues/${issue.id}`)}
                        className={`cursor-pointer border-t border-outline-variant hover:bg-surface-container-low transition-colors ${
                          issue.status === 'FAILED' ? 'bg-rose-50/40' : ''
                        }`}
                      >
                        <td
                          className={`px-lg py-md font-mono text-code-sm ${
                            resolved ? 'text-outline line-through' : 'text-on-surface-variant'
                          }`}
                        >
                          {currentProject?.key}-{issue.issue_number}
                        </td>
                        <td
                          className={`px-lg py-md text-body-lg ${
                            resolved ? 'text-on-surface-variant line-through' : 'text-on-surface'
                          }`}
                        >
                          {issue.title}
                        </td>
                        <td className="px-lg py-md">
                          <Priority.icon className={Priority.className} size={18} />
                        </td>
                        <td className="px-lg py-md">
                          <span
                            className={`rounded-sm px-sm py-[2px] text-label-md font-semibold uppercase ${statusConfig[issue.status]}`}
                          >
                            {issue.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-lg py-md">
                          {issue.assignee?.full_name ? (
                            <div className="flex items-center gap-sm">
                              <Avatar
                                name={issue.assignee.full_name}
                                avatarUrl={issue.assignee.avatar_url}
                                size={28}
                              />
                              <span className="text-body-md text-on-surface">
                                {issue.assignee.full_name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                              <User size={14} />
                            </div>
                          )}
                        </td>
                        <td className="px-lg py-md text-body-md text-on-surface-variant">
                          {issue.reporter?.full_name ?? '—'}
                        </td>
                        <td className="px-lg py-md text-body-md text-on-surface-variant">
                          {timeAgo(issue.created_at)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-lg py-md">
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
    </div>
  )
}

export default Issues

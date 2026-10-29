import DeadlineOverview from '../components/DeadlineOverview'
import IssueWorkOverview from '../components/IssueWorkOverview'
import { workGroup, workGroups, workGroupOrder } from '../lib/issueWork'
import { useDeadlineClock } from '../hooks/useDeadlineClock'
import LoadError from '../components/LoadError'
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  Clock,
  Equal,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchDashboardData,
  prefetchIssuesData,
  queryCache,
  type DashboardRecentIssue,
  type DashboardTask,
} from '../lib/cache'
import type {
  IssuePriority,
  IssueStatus,
  ProjectDashboardStats,
} from '../lib/database.types'

const statusTone: Record<
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

const priorityConfig: Record<
  IssuePriority,
  { label: string; icon: typeof ChevronsUp; className: string }
> = {
  CRITICAL: { label: 'Critical', icon: ChevronsUp, className: 'text-rose-600' },
  HIGH: { label: 'High', icon: ChevronUp, className: 'text-amber-600' },
  MEDIUM: { label: 'Medium', icon: Equal, className: 'text-slate-500' },
  LOW: { label: 'Low', icon: ChevronDown, className: 'text-slate-400' },
}

type RecentIssue = DashboardRecentIssue
type MyTask = DashboardTask

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

function Dashboard() {
  const [loadError, setLoadError] = useState<string | null>(null)
  const { profile, user } = useAuth()
  const { currentProject, currentRole, canReportIssues } = useProject()
  const [unassignedCount, setUnassignedCount] = useState(0)
  const requestVersion = useRef(0)
  const minute = useDeadlineClock()
  const previousMinute = useRef(minute)

  const [stats, setStats] = useState<ProjectDashboardStats | null>(null)
  const [recentIssues, setRecentIssues] = useState<RecentIssue[]>([])
  const [myTasks, setMyTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject || !user) return

      const userId = user.id
      const cacheKey = `dashboard:${currentProject.id}:${userId}:active`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (forceRefresh) {
        setRefreshing(true)
      } else if (!hasCached) {
        setLoading(true)
      }

      setLoadError(null)
      const version = ++requestVersion.current
      try {
        const [data] = await Promise.all([
          fetchDashboardData(currentProject.id, userId, { forceRefresh }),
          forceRefresh ? new Promise((r) => setTimeout(r, 500)) : Promise.resolve(),
        ])
        if (version !== requestVersion.current) return
        setStats(data.stats)
        setRecentIssues(data.recentIssues)
        setMyTasks(data.myTasks)
        setUnassignedCount(data.unassignedCount)
      } catch {
        if (version === requestVersion.current) setLoadError('Unable to load data. Check your connection and retry.')
      } finally {
        if (version === requestVersion.current) { setLoading(false); setRefreshing(false) }
      }

      prefetchIssuesData(currentProject.id)
    },
    [currentProject, user],
  )

  useEffect(() => {
    const clockChanged = previousMinute.current !== minute
    previousMinute.current = minute
    void loadData(clockChanged)
  }, [loadData, minute])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: profile?.id,
    onRefresh: () => loadData(true),
  })

  const today = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const personalTasks = [...myTasks].sort((a, b) => workGroupOrder(a, user?.id ?? '', currentRole) - workGroupOrder(b, user?.id ?? '', currentRole))

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="flex-1 px-md py-md lg:px-lg lg:py-lg">
          <LoadError message={loadError} onRetry={() => void loadData(true)} />
          {/* Workbench Header Strip */}
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between border-b border-outline-variant pb-md">
            <div>
              <div className="flex items-center gap-xs">
                <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                  [{currentProject?.key ?? 'QA'}]
                </span>
                <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                  {currentProject?.name ?? 'Quality Assurance Workbench'}
                </h1>
              </div>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Track bug fixes, test results, and overall project progress.
              </p>
            </div>

            <div className="flex items-center gap-xs sm:gap-sm">
              <div className="hidden items-center gap-xs rounded-md border border-outline-variant bg-surface-container-low px-md py-xs text-body-md text-on-surface-variant md:flex">
                <Calendar size={16} className="text-outline" />
                <span>{today}</span>
              </div>
              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={refreshing}
                title="Refresh sync data"
                aria-label="Refresh dashboard data"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-outline hover:bg-surface-container hover:text-primary active:scale-95 disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  className={refreshing ? 'animate-spin text-primary' : ''}
                />
              </button>
              {canReportIssues && <Link
                to="/issues/new"
                className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
              >
                <Plus size={16} />
                <span>New Issue</span>
              </Link>}
            </div>
          </div>

          {loading ? (
            <div className="py-xl text-center">
              <p className="text-body-lg text-on-surface-variant">Loading workbench status…</p>
            </div>
          ) : (
            <>
              <DeadlineOverview stats={stats} />
              <IssueWorkOverview stats={stats} unassignedCount={unassignedCount} owner={currentRole === 'OWNER'} />

              {/* Two-Column Workbench Canvas */}
              <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
                {/* Left Column: Verification Backlog & Active Issues */}
                <div className="flex flex-col lg:col-span-8 min-w-0">
                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                    <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant px-lg py-md">
                      <div className="flex flex-wrap items-center gap-sm">
                        <h3 className="text-headline-md font-semibold text-on-surface">
                          Active Issues
                        </h3>
                      </div>
                      <Link
                        to="/issues?view=active"
                        className="inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
                      >
                        <span>View Full Backlog</span>
                        <ArrowRight size={14} />
                      </Link>
                    </div>

                    {recentIssues.length === 0 ? (
                      <div className="px-lg py-xl text-center">
                        <p className="text-body-lg text-on-surface-variant">
                          No active issues. Completed history is available from the workload summary.
                        </p>

                      </div>
                    ) : (
                      <>
                        {/* Mobile List */}
                        <div className="divide-y divide-outline-variant md:hidden">
                          {recentIssues.map((issue) => {
                            const status = statusTone[issue.status]
                            const priority = priorityConfig[issue.priority]
                            const PriorityIcon = priority.icon

                            return (
                              <Link
                                key={issue.id}
                                to={`/issues/${issue.id}`}
                                className="flex items-start gap-sm p-md transition-colors hover:bg-surface-container-low"
                              >
                                <Avatar
                                  name={issue.assignee?.full_name}
                                  avatarUrl={issue.assignee?.avatar_url}
                                  size={32}
                                  className="shrink-0 border border-outline-variant"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-xs">
                                    <span className="font-mono text-code-sm font-semibold text-primary">
                                      {currentProject?.key}-{issue.issue_number}
                                    </span>
                                    <PriorityIcon size={14} className={priority.className} />
                                  </div>
                                  <p className="mt-xs truncate text-body-md font-medium text-on-surface">
                                    {issue.title}
                                  </p>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full px-sm py-[2px] text-label-md ${status.badge}`}
                                >
                                  {status.label}
                                </span>
                              </Link>
                            )
                          })}
                        </div>

                        {/* Desktop Dense Table */}
                        <div className="hidden overflow-x-auto md:block">
                          <table className="w-full border-collapse text-left">
                            <thead>
                              <tr className="border-b border-outline-variant bg-surface-container-low text-label-md font-semibold uppercase tracking-wider text-on-surface-variant">
                                <th className="px-lg py-sm">ID</th>
                                <th className="px-lg py-sm">Summary</th>
                                <th className="px-lg py-sm">Status</th>
                                <th className="px-lg py-sm">Priority</th>
                                <th className="px-lg py-sm">Assignee</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-outline-variant">
                              {recentIssues.map((issue) => {
                                const status = statusTone[issue.status]
                                const priority = priorityConfig[issue.priority]
                                const PriorityIcon = priority.icon

                                return (
                                  <tr
                                    key={issue.id}
                                    className="group transition-colors hover:bg-surface-container-low"
                                  >
                                    <td className="whitespace-nowrap px-lg py-md">
                                      <Link
                                        to={`/issues/${issue.id}`}
                                        className="font-mono text-code-sm font-semibold text-primary hover:underline"
                                      >
                                        {currentProject?.key}-{issue.issue_number}
                                      </Link>
                                    </td>
                                    <td className="max-w-[320px] px-lg py-md">
                                      <Link
                                        to={`/issues/${issue.id}`}
                                        className="block truncate text-body-md font-medium text-on-surface transition-colors group-hover:text-primary"
                                      >
                                        {issue.title}
                                      </Link>
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
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Right Column: Operator Tasks & QA Shortcuts */}
                <div className="flex flex-col gap-lg lg:col-span-4 min-w-0">
                  {/* Assigned to Me Panel */}
                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                    <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
                      <div className="flex items-center gap-xs">
                        <h3 className="text-headline-md font-semibold text-on-surface">
                          My Active Work
                        </h3>
                        <span className="rounded bg-surface-container px-sm py-[2px] font-mono text-code-xs font-semibold text-on-surface-variant">
                          {myTasks.length}
                        </span>
                      </div>
                      <Link
                        to="/my-tasks"
                        className="text-body-md font-semibold text-primary hover:underline"
                      >
                        View All
                      </Link>
                    </div>

                    {myTasks.length === 0 ? (
                      <div className="p-lg text-center">
                        <p className="text-body-md text-on-surface-variant">
                          No active assigned or reported issues.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-outline-variant">
                        {personalTasks.slice(0, 5).map((task) => (
                          <Link
                            key={task.id}
                            to={`/issues/${task.id}`}
                            className="group flex items-start justify-between gap-sm p-md transition-colors hover:bg-surface-container-low"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-mono text-code-xs font-semibold text-primary">
                                {currentProject?.key}-{task.issue_number}
                              </span>
                              <p className="truncate text-body-md font-medium text-on-surface transition-colors group-hover:text-primary">
                                {task.title}
                              </p>
                              <div className="mt-xs flex items-center gap-xs text-label-md text-on-surface-variant">
                                <Clock size={12} />
                                <span>{timeAgo(task.updated_at)}</span>
                              </div>
                              <span className="text-label-md text-on-surface-variant">{workGroups.find((group) => group.key === workGroup(task, user?.id ?? '', currentRole))?.label}</span>
                            </div>
                            <ChevronRight
                              size={16}
                              className="mt-1 shrink-0 text-outline transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                            />
                          </Link>
                        ))}
                      </div>
                    )}

                  </div>

                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default Dashboard

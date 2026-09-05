import {
  Calendar,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  ClipboardList,
  Equal,
  Flag,
  FlaskConical,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

const statusTone: Record<IssueStatus, string> = {
  OPEN: 'bg-rose-50 text-rose-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  FOR_TESTING: 'bg-purple-50 text-purple-700',
  PASSED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
  DONE: 'bg-surface-container text-on-surface-variant',
}

const priorityConfig: Record<
  IssuePriority,
  { icon: typeof ChevronsUp; className: string }
> = {
  CRITICAL: { icon: ChevronsUp, className: 'text-rose-600' },
  HIGH: { icon: ChevronUp, className: 'text-amber-600' },
  MEDIUM: { icon: Equal, className: 'text-outline' },
  LOW: { icon: ChevronDown, className: 'text-outline' },
}

type RecentIssue = DashboardRecentIssue
type MyTask = DashboardTask

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
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

function Dashboard() {
  const { user, profile } = useAuth()
  const { currentProject } = useProject()

  const [stats, setStats] = useState<ProjectDashboardStats | null>(null)
  const [recentIssues, setRecentIssues] = useState<RecentIssue[]>([])
  const [myTasks, setMyTasks] = useState<MyTask[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject) return

      const userId = profile?.id ?? ''
      const cacheKey = `dashboard:${currentProject.id}:${userId}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached) {
        setLoading(true)
      }

      try {
        const data = await fetchDashboardData(currentProject.id, userId, {
          forceRefresh,
        })
        setStats(data.stats)
        setRecentIssues(data.recentIssues)
        setMyTasks(data.myTasks)
      } finally {
        setLoading(false)
      }

      // Prefetch the issues page data while the user is on Dashboard
      prefetchIssuesData(currentProject.id)
    },
    [currentProject, profile?.id],
  )

  useEffect(() => {
    loadData()
  }, [loadData])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => loadData(true),
  })

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const today = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const tested =
    (stats?.passed_issues ?? 0) + (stats?.failed_issues ?? 0) + (stats?.done_issues ?? 0)
  const passedPct = tested ? Math.round(((stats?.passed_issues ?? 0) / tested) * 100) : 0
  const failedPct = tested ? Math.round(((stats?.failed_issues ?? 0) / tested) * 100) : 0
  const donePct = tested ? 100 - passedPct - failedPct : 0

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col">
        <TopBar />

        <main className="flex-1 px-lg py-lg">
          <div className="mb-lg flex items-start justify-between">
            <div>
              <h1 className="text-headline-xl font-bold text-on-surface">
                {getGreeting()}, {firstName}
              </h1>
              <p className="mt-xs text-body-lg text-on-surface-variant">
                Here is what's happening with {currentProject?.name} today.
              </p>
            </div>
            <div className="flex items-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-medium text-on-surface">
              <Calendar size={16} />
              {today}
            </div>
          </div>

          {loading ? (
            <p className="text-body-lg text-on-surface-variant">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-4">
              <div className="flex flex-col gap-lg lg:col-span-3">
                <div className="grid grid-cols-2 gap-lg md:grid-cols-4">
                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised lg:p-lg">
                    <div className="flex items-center justify-between gap-sm">
                      <span className="min-w-0 truncate text-body-md font-medium text-on-surface-variant">
                        Open Issues
                      </span>
                      <ClipboardList className="shrink-0 text-outline" size={18} />
                    </div>
                    <span className="mt-sm block text-headline-lg font-bold text-on-surface lg:text-headline-xl">
                      {stats?.open_issues ?? 0}
                    </span>
                  </div>

                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised lg:p-lg">
                    <div className="flex items-center justify-between gap-sm">
                      <span className="min-w-0 truncate text-body-md font-medium text-on-surface-variant">
                        In Progress
                      </span>
                      <RefreshCw className="shrink-0 text-outline" size={18} />
                    </div>
                    <span className="mt-sm block text-headline-lg font-bold text-on-surface lg:text-headline-xl">
                      {stats?.in_progress_issues ?? 0}
                    </span>
                  </div>

                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised lg:p-lg">
                    <div className="flex items-center justify-between gap-sm">
                      <span className="min-w-0 truncate text-body-md font-medium text-on-surface-variant">
                        For Testing
                      </span>
                      <FlaskConical className="shrink-0 text-outline" size={18} />
                    </div>
                    <span className="mt-sm block text-headline-lg font-bold text-on-surface lg:text-headline-xl">
                      {stats?.for_testing_issues ?? 0}
                    </span>
                  </div>

                  <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised lg:p-lg">
                    <div className="flex items-center justify-between gap-sm">
                      <span className="min-w-0 truncate text-body-md font-medium text-on-surface-variant">
                        Completed
                      </span>
                      <CircleCheck className="shrink-0 text-outline" size={18} />
                    </div>
                    <div className="mt-sm flex flex-col items-start gap-xs">
                      <span className="text-headline-lg font-bold text-on-surface lg:text-headline-xl">
                        {stats?.done_issues ?? 0}
                      </span>
                      <span className="whitespace-nowrap rounded-full bg-surface-container px-sm py-[2px] text-label-md font-semibold text-on-surface-variant">
                        {stats?.completed_this_week ?? 0} this week
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
                  <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      Recent Issues
                    </h2>
                    <Link
                      to="/issues"
                      className="text-body-md font-semibold text-primary hover:underline"
                    >
                      View All
                    </Link>
                  </div>

                  {recentIssues.length === 0 ? (
                    <p className="px-lg py-lg text-body-lg text-on-surface-variant">
                      No issues yet.{' '}
                      <Link to="/issues/new" className="font-semibold text-primary hover:underline">
                        Report the first one
                      </Link>
                      .
                    </p>
                  ) : (
                    <>
                    <div className="md:hidden">
                      {recentIssues.map((issue) => {
                        const Priority = priorityConfig[issue.priority]
                        return (
                          <Link
                            key={issue.id}
                            to={`/issues/${issue.id}`}
                            className="flex items-start gap-sm border-t border-outline-variant px-lg py-md hover:bg-surface-container-low"
                          >
                            <Avatar
                              name={issue.assignee?.full_name}
                              avatarUrl={issue.assignee?.avatar_url}
                              size={32}
                              className="shrink-0 border border-outline-variant"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-xs text-label-md text-on-surface-variant">
                                <span className="font-mono">
                                  {currentProject?.key}-{issue.issue_number}
                                </span>
                                <Priority.icon className={Priority.className} size={14} />
                              </div>
                              <p className="mt-xs truncate text-body-md text-on-surface">
                                {issue.title}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-sm py-[2px] text-label-md font-semibold ${statusTone[issue.status]}`}
                            >
                              {issue.status.replace('_', ' ')}
                            </span>
                          </Link>
                        )
                      })}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-label-md uppercase tracking-wide text-on-surface-variant">
                          <th className="px-lg py-sm font-semibold">ID</th>
                          <th className="px-lg py-sm font-semibold">Summary</th>
                          <th className="px-lg py-sm font-semibold">Status</th>
                          <th className="px-lg py-sm font-semibold">Priority</th>
                          <th className="px-lg py-sm font-semibold">Assignee</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentIssues.map((issue) => {
                          const Priority = priorityConfig[issue.priority]
                          return (
                            <tr
                              key={issue.id}
                              className="border-t border-outline-variant hover:bg-surface-container-low"
                            >
                              <td className="px-lg py-md font-mono text-code-sm text-on-surface-variant">
                                <Link to={`/issues/${issue.id}`}>
                                  {currentProject?.key}-{issue.issue_number}
                                </Link>
                              </td>
                              <td className="px-lg py-md text-body-lg text-on-surface">
                                {issue.title}
                              </td>
                              <td className="px-lg py-md">
                                <span
                                  className={`rounded-full px-sm py-[2px] text-label-md font-semibold ${statusTone[issue.status]}`}
                                >
                                  {issue.status.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="px-lg py-md">
                                <span
                                  className={`flex items-center gap-xs text-body-md font-medium ${Priority.className}`}
                                >
                                  <Priority.icon size={16} />
                                  {issue.priority}
                                </span>
                              </td>
                              <td className="px-lg py-md">
                                <Avatar
                                  name={issue.assignee?.full_name}
                                  avatarUrl={issue.assignee?.avatar_url}
                                  size={32}
                                  className="border border-outline-variant"
                                />
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

              <div className="flex flex-col gap-lg lg:col-span-1">
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
                  <h2 className="text-headline-md font-semibold text-on-surface">
                    QA Progress
                  </h2>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Test execution status across all issues.
                  </p>

                  <div className="mt-md flex h-2 w-full overflow-hidden rounded-full bg-surface-container">
                    <div className="h-full bg-emerald-500" style={{ width: `${passedPct}%` }} />
                    <div className="h-full bg-rose-500" style={{ width: `${failedPct}%` }} />
                  </div>

                  <div className="mt-md flex flex-wrap items-center gap-md text-body-md text-on-surface-variant">
                    <span className="flex items-center gap-xs">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Passed ({passedPct}%)
                    </span>
                    <span className="flex items-center gap-xs">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      Failed ({failedPct}%)
                    </span>
                    <span className="flex items-center gap-xs">
                      <span className="h-2 w-2 rounded-full bg-surface-container-highest" />
                      Done ({donePct}%)
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
                  <div className="px-lg py-md">
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      My Tasks
                    </h2>
                  </div>

                  {myTasks.length === 0 ? (
                    <p className="px-lg pb-md text-body-md text-on-surface-variant">
                      Nothing assigned to you right now.
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {myTasks.map((task) => (
                        <Link
                          key={task.id}
                          to={`/issues/${task.id}`}
                          className="flex items-start gap-sm border-t border-outline-variant px-lg py-md hover:bg-surface-container-low"
                        >
                          <div>
                            <p className="text-body-lg text-on-surface">
                              {currentProject?.key}-{task.issue_number}: {task.title}
                            </p>
                            <div className="mt-xs flex items-center gap-sm text-body-md text-on-surface-variant">
                              <Flag size={14} />
                              {timeAgo(task.updated_at)}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}

                  <Link
                    to="/issues/new"
                    className="flex w-full items-center justify-center gap-xs border-t border-outline-variant px-lg py-md text-body-md font-semibold text-primary hover:bg-surface-container-low"
                  >
                    <Plus size={16} />
                    Add Task
                  </Link>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default Dashboard

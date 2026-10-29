import type { IssueStatus, ProjectDashboardStats, ProjectRole } from './database.types'
import { canDevelopIssues } from './permissions.ts'

export type IssueLifecycle = 'active' | 'completed' | 'all'
export const lifecycleLabels: Record<IssueLifecycle, string> = { active: 'Active', completed: 'Completed', all: 'All' }
export function issueLifecycle(value: string | null, status?: IssueStatus | ''): IssueLifecycle {
  return value === 'active' || value === 'completed' || value === 'all' ? value : status === 'DONE' ? 'completed' : 'active'
}
export function matchesLifecycle(status: IssueStatus, lifecycle: IssueLifecycle): boolean {
  return lifecycle === 'all' || (lifecycle === 'completed' ? status === 'DONE' : status !== 'DONE')
}

export type WorkGroup = 'action' | 'progress' | 'waiting' | 'completed'
export const workGroups: { key: WorkGroup; label: string; description: string }[] = [
  { key: 'action', label: 'Needs your action', description: 'Ready for you to assign, start, resume, verify, or close.' },
  { key: 'progress', label: 'In progress', description: 'Development work currently assigned to you.' },
  { key: 'waiting', label: 'Waiting', description: 'Related issues awaiting another person or an eligible assignee.' },
  { key: 'completed', label: 'Completed', description: 'Closed issues kept with their evidence and history.' },
]
type Responsibility = { status: IssueStatus; assignee_id: string | null; reporter_id: string | null }
export function workGroup(issue: Responsibility, userId: string, role: ProjectRole | null): WorkGroup {
  if (issue.status === 'DONE') return 'completed'
  const reporter = issue.reporter_id === userId
  const developer = issue.assignee_id === userId && canDevelopIssues(role)
  if (developer && issue.status === 'IN_PROGRESS') return 'progress'
  if ((developer && (issue.status === 'OPEN' || issue.status === 'FAILED'))
    || (reporter && issue.status === 'FOR_TESTING')
    || ((reporter || (developer && role === 'OWNER')) && issue.status === 'PASSED')
    || (reporter && !issue.assignee_id && (issue.status === 'OPEN' || issue.status === 'FAILED'))) return 'action'
  return 'waiting'
}
export function workGroupOrder(issue: Responsibility, userId: string, role: ProjectRole | null): number {
  return workGroups.findIndex((group) => group.key === workGroup(issue, userId, role))
}
export function issueTotals(stats: ProjectDashboardStats | null) {
  const active = (stats?.open_issues ?? 0) + (stats?.in_progress_issues ?? 0)
    + (stats?.for_testing_issues ?? 0) + (stats?.passed_issues ?? 0) + (stats?.failed_issues ?? 0)
  const completed = stats?.done_issues ?? 0
  return { active, completed, all: active + completed }
}

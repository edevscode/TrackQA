import { issueLifecycle, matchesLifecycle } from './issueWork.ts'
import type { IssuePriority, IssueStatus } from './database.types'
import type { DeadlineFilter } from './deadlines'

export type QueuePath = '/issues' | '/my-tasks'
export type QueueState = {
  view: 'active' | 'completed' | 'all'; status: IssueStatus | ''; priority: IssuePriority | ''
  q: string; page: number; assignee: string; deadline: DeadlineFilter; order: string
  scope: 'mine' | 'assigned' | 'reported'
}
export type QueueReturn = { pathname: QueuePath; search: string; projectId: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses = ['OPEN', 'IN_PROGRESS', 'FOR_TESTING', 'PASSED', 'FAILED', 'DONE']
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const taskSorts = ['next_deadline_asc', 'deadline_asc', 'updated_desc', 'updated_asc', 'number_desc', 'number_asc', 'priority_desc']

export function readQueue(path: QueuePath, input: URLSearchParams, projectId: string): QueueState {
  // Scope saved filters to a project; switching projects cannot reuse its page or assignee.
  const params = input.has('project') && input.get('project') !== projectId ? new URLSearchParams() : input
  const requestedStatus = params.get('status') ?? ''
  const status = statuses.includes(requestedStatus) ? requestedStatus as IssueStatus : ''
  const view = issueLifecycle(params.get('view'), status)
  const priority = params.get('priority') ?? ''
  const assignee = params.get('assignee') ?? ''
  const deadline = params.get('deadline') ?? ''
  const defaultOrder = path === '/issues' ? (deadline === 'upcoming' && view !== 'completed' ? 'next' : 'newest') : 'updated_desc'
  const requestedOrder = params.get('order') ?? defaultOrder
  const allowedSorts = path === '/issues' ? (view === 'completed' ? ['newest'] : ['newest', 'deadline', 'next'])
    : taskSorts.filter(value => view !== 'completed' || !['next_deadline_asc', 'deadline_asc'].includes(value))
  const page = params.get('page') ?? '1'
  const scope = params.get('scope')
  return {
    view, status: status && matchesLifecycle(status, view) ? status : '',
    priority: priorities.includes(priority) ? priority as IssuePriority : '',
    q: (params.get('q') ?? '').replace(/\p{Cc}/gu, '').slice(0, 500),
    page: /^\d{1,6}$/.test(page) && Number(page) > 0 ? Number(page) : 1,
    assignee: path === '/issues' && (assignee === 'unassigned' || uuid.test(assignee)) ? assignee : '',
    deadline: view !== 'completed' && ['upcoming', 'overdue', 'missed'].includes(deadline) ? deadline as DeadlineFilter : '',
    order: allowedSorts.includes(requestedOrder) ? requestedOrder : defaultOrder,
    scope: path === '/my-tasks' && (scope === 'assigned' || scope === 'reported') ? scope : 'mine',
  }
}

export function queueParams(path: QueuePath, state: QueueState, projectId: string): URLSearchParams {
  const params = new URLSearchParams({ project: projectId, view: state.view })
  for (const key of ['status', 'priority', 'q', 'deadline', 'order'] as const) if (state[key]) params.set(key, state[key])
  if (state.page > 1) params.set('page', String(state.page))
  if (path === '/issues' && state.assignee) params.set('assignee', state.assignee)
  if (path === '/my-tasks' && state.scope !== 'mine') params.set('scope', state.scope)
  return params
}

export function changeQueue(path: QueuePath, current: QueueState, patch: Partial<QueueState>, projectId: string) {
  const next = { ...current, ...patch, page: patch.page ?? 1 }
  return queueParams(path, readQueue(path, queueParams(path, next, projectId), projectId), projectId)
}

export function queueReturn(state: unknown, projectId: string | undefined): { to: string; label: string } {
  const fallback = { to: '/issues', label: 'Backlog' }
  if (!projectId || !state || typeof state !== 'object' || !('queueReturn' in state)) return fallback
  const value = state.queueReturn as Partial<QueueReturn> | null
  if (!value || value.projectId !== projectId || !uuid.test(projectId)
    || (value.pathname !== '/issues' && value.pathname !== '/my-tasks')
    || typeof value.search !== 'string' || value.search.length > 4096) return fallback
  const params = queueParams(value.pathname, readQueue(value.pathname, new URLSearchParams(value.search), projectId), projectId)
  return { to: `${value.pathname}?${params}`, label: value.pathname === '/my-tasks' ? 'My Tasks' : 'Backlog' }
}

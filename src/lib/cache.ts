import { supabase } from './supabase'
import type {
  Issue,
  IssuePriority,
  IssueStatus,
  Notification,
  NotificationPreferences,
  ProjectDashboardStats,
  ProjectInvitation,
  ProjectRole,
  IssueDeadlines,
} from './database.types'
import type { DeadlineFilter } from './deadlines'

import { MemoryCache } from './memoryCache'

const DEFAULT_TTL_MS = 60 * 1000

export const queryCache = new MemoryCache()

export function invalidateProjectCache(projectId: string): void {
  queryCache.invalidate(new RegExp(`^(dashboard|issues|mytasks|members|project_settings):${projectId}`))
}

export function invalidateMyTasksCache(projectId?: string, userId?: string): void {
  if (projectId && userId) {
    queryCache.invalidate(new RegExp(`^mytasks:${projectId}:${userId}`))
  } else if (projectId) {
    queryCache.invalidate(new RegExp(`^mytasks:${projectId}`))
  } else {
    queryCache.invalidate(new RegExp(`^mytasks:`))
  }
}

export function invalidateMembersCache(projectId: string): void {
  queryCache.invalidate(new RegExp(`^(members|project_settings):${projectId}`))
}

export function invalidateNotificationsCache(userId?: string): void {
  if (userId) {
    queryCache.invalidate(new RegExp(`^notifications:${userId}`))
  } else {
    queryCache.invalidate(new RegExp(`^notifications:`))
  }
}

export function invalidateProjectSettingsCache(projectId: string): void {
  queryCache.invalidate(new RegExp(`^project_settings:${projectId}`))
}

export function invalidateAccountSettingsCache(userId?: string): void {
  if (userId) {
    queryCache.invalidate(new RegExp(`^account_preferences:${userId}`))
  } else {
    queryCache.invalidate(new RegExp(`^account_preferences:`))
  }
}

// ---------------------------------------------------------------------------
// 1. Dashboard Cache & Fetcher
// ---------------------------------------------------------------------------

export type DashboardRecentIssue = Pick<
  Issue,
  'id' | 'issue_number' | 'title' | 'status' | 'priority'
> & { assignee: { full_name: string | null; avatar_url: string | null } | null }

export type DashboardTask = Pick<
  Issue,
  'id' | 'issue_number' | 'title' | 'status' | 'updated_at'
>

export type DashboardData = {
  stats: ProjectDashboardStats | null
  recentIssues: DashboardRecentIssue[]
  myTasks: DashboardTask[]
}

export async function fetchDashboardData(
  projectId: string,
  userId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<DashboardData> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `dashboard:${projectId}:${userId}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<DashboardData>(cacheKey)
    if (cached) return cached
  }

  const [statsRes, issuesRes, tasksRes] = await Promise.all([
    supabase
      .from('v_project_dashboard_stats')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('issues')
      .select(
        'id, issue_number, title, status, priority, assignee:profiles!issues_assignee_id_fkey(full_name, avatar_url)',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('issues')
      .select('id, issue_number, title, status, updated_at')
      .eq('project_id', projectId)
      .eq('assignee_id', userId)
      .neq('status', 'DONE')
      .order('updated_at', { ascending: false })
      .limit(3),
  ])

  for (const response of [statsRes, issuesRes, tasksRes]) {
    if (response.error) throw response.error
  }

  const result: DashboardData = {
    stats: statsRes.data ?? null,
    recentIssues: (issuesRes.data as unknown as DashboardRecentIssue[]) ?? [],
    myTasks: (tasksRes.data as unknown as DashboardTask[]) ?? [],
  }

  queryCache.set(cacheKey, result, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return result
}

// ---------------------------------------------------------------------------
// 2. Issues Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export type IssueListItem = Pick<
  Issue,
  'id' | 'issue_number' | 'title' | 'priority' | 'status' | 'created_at' | 'reporter_id' | 'assignee_id'
> & IssueDeadlines & {
  assignee: { full_name: string | null; avatar_url: string | null } | null
  reporter: { full_name: string | null } | null
}

export type IssueQueryParams = {
  page?: number
  pageSize?: number
  statusFilter?: IssueStatus | ''
  priorityFilter?: IssuePriority | ''
  assigneeFilter?: string
  search?: string
  deadlineFilter?: DeadlineFilter
  sortBy?: 'newest' | 'deadline'
}

export type IssuesResponse = {
  issues: IssueListItem[]
  totalCount: number
}

export async function fetchIssuesData(
  projectId: string,
  params: IssueQueryParams = {},
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<IssuesResponse> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 10
  const normalizedParams = {
    page,
    pageSize,
    statusFilter: params.statusFilter || '',
    priorityFilter: params.priorityFilter || '',
    assigneeFilter: params.assigneeFilter || '',
    search: params.search?.trim() || '',
    deadlineFilter: params.deadlineFilter || '',
    sortBy: params.sortBy || 'newest',
  }

  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `issues:${projectId}:${JSON.stringify(normalizedParams)}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<IssuesResponse>(cacheKey)
    if (cached) return cached
  }

  let query = supabase
    .from('v_issue_deadlines')
    .select(
      '*, assignee:profiles!issues_assignee_id_fkey(full_name, avatar_url), reporter:profiles!issues_reporter_id_fkey(full_name)',
      { count: 'exact' },
    )
    .eq('project_id', projectId)

  if (normalizedParams.statusFilter) {
    query = query.eq('status', normalizedParams.statusFilter as IssueStatus)
  }
  if (normalizedParams.priorityFilter) {
    query = query.eq('priority', normalizedParams.priorityFilter as IssuePriority)
  }
  if (normalizedParams.assigneeFilter) {
    query = query.eq('assignee_id', normalizedParams.assigneeFilter)
  }
  if (normalizedParams.search) {
    query = query.ilike('title', `%${normalizedParams.search}%`)
  }
  if (normalizedParams.deadlineFilter === 'overdue') query = query.eq('is_overdue', true)
  if (normalizedParams.deadlineFilter === 'missed') query = query.eq('has_missed_target', true).neq('status', 'DONE')
  if (normalizedParams.sortBy === 'deadline') query = query.order('resolution_sort_date', { ascending: true, nullsFirst: false })

  const { data, count, error } = await query
    .order('issue_number', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (error) throw error

  const result: IssuesResponse = {
    issues: (data as unknown as IssueListItem[]) ?? [],
    totalCount: count ?? 0,
  }

  queryCache.set(cacheKey, result, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return result
}

export function prefetchIssuesData(projectId: string): void {
  if (!projectId) return
  fetchIssuesData(projectId, { page: 1, pageSize: 10 }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 3. My Tasks Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export type MyTasksItem = IssueDeadlines & Pick<
  Issue,
  | 'id'
  | 'issue_number'
  | 'title'
  | 'priority'
  | 'status'
  | 'updated_at'
  | 'created_at'
  | 'assignee_id'
  | 'reporter_id'
>

export async function fetchMyTasksData(
  projectId: string,
  userId: string,
  tab: 'assigned' | 'reported',
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<MyTasksItem[]> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `mytasks:${projectId}:${userId}:${tab}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<MyTasksItem[]>(cacheKey)
    if (cached) return cached
  }

  let query = supabase
    .from('v_issue_deadlines')
    .select('*')
    .eq('project_id', projectId)

  if (tab === 'assigned') {
    query = query.eq('assignee_id', userId)
  } else {
    query = query.eq('reporter_id', userId)
  }

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw error
  const result = (data as MyTasksItem[]) ?? []

  queryCache.set(cacheKey, result, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return result
}

export function prefetchMyTasksData(projectId: string, userId: string): void {
  if (!projectId || !userId) return
  fetchMyTasksData(projectId, userId, 'assigned').catch(() => {})
  fetchMyTasksData(projectId, userId, 'reported').catch(() => {})
}

// ---------------------------------------------------------------------------
// 4. Members Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export type MemberListItem = {
  user_id: string
  role: ProjectRole
  full_name: string | null
  email: string
  avatar_url: string | null
  assigned_issues: number
}

export type MembersResponse = {
  members: MemberListItem[]
  pendingInvitations: ProjectInvitation[]
}

export async function fetchMembersData(
  projectId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<MembersResponse> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `members:${projectId}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<MembersResponse>(cacheKey)
    if (cached) return cached
  }

  const [membersRes, statsRes, invitationsRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('user_id, role, profiles(full_name, email, avatar_url)')
      .eq('project_id', projectId),
    supabase
      .from('v_member_stats')
      .select('user_id, assigned_issues')
      .eq('project_id', projectId),
    supabase
      .from('project_invitations')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
  ])

  for (const response of [membersRes, statsRes, invitationsRes]) {
    if (response.error) throw response.error
  }

  const statsByUser = new Map(
    (statsRes.data ?? []).map((s) => [s.user_id, s.assigned_issues]),
  )

  const rows: MemberListItem[] = (membersRes.data ?? []).map((m) => {
    const p = (
      m as unknown as {
        profiles: { full_name: string | null; email: string; avatar_url: string | null }
      }
    ).profiles
    return {
      user_id: m.user_id,
      role: m.role,
      full_name: p?.full_name ?? null,
      email: p?.email ?? '',
      avatar_url: p?.avatar_url ?? null,
      assigned_issues: statsByUser.get(m.user_id) ?? 0,
    }
  })

  const result: MembersResponse = {
    members: rows,
    pendingInvitations: (invitationsRes.data as ProjectInvitation[]) ?? [],
  }

  queryCache.set(cacheKey, result, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return result
}

export function prefetchMembersData(projectId: string): void {
  if (!projectId) return
  fetchMembersData(projectId).catch(() => {})
}

// ---------------------------------------------------------------------------
// 5. Notifications Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export type EnrichedNotificationItem = Notification & {
  actor: { full_name: string | null; avatar_url: string | null } | null
  project: { name: string; key: string } | null
  issue: {
    id: string
    issue_number: number
    title: string
    status: IssueStatus
    priority: IssuePriority
  } | null
}

export async function fetchNotificationsData(
  userId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<EnrichedNotificationItem[]> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `notifications:${userId}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<EnrichedNotificationItem[]>(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from('notifications')
    .select(
      '*, actor:profiles!notifications_actor_id_fkey(full_name, avatar_url), project:projects!notifications_project_id_fkey(name, key), issue:issues!notifications_issue_id_fkey(id, issue_number, title, status, priority)',
    )
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  const result = (data as unknown as EnrichedNotificationItem[]) ?? []
  queryCache.set(cacheKey, result, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return result
}

export function prefetchNotificationsData(userId: string): void {
  if (!userId) return
  fetchNotificationsData(userId).catch(() => {})
}

// ---------------------------------------------------------------------------
// 6. Project Settings Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export type ProjectSettingsMember = {
  user_id: string
  role: ProjectRole
  full_name: string | null
  avatar_url: string | null
  email: string
}

export async function fetchProjectSettingsData(
  projectId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<ProjectSettingsMember[]> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `project_settings:${projectId}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<ProjectSettingsMember[]>(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, profiles(full_name, avatar_url, email)')
    .eq('project_id', projectId)

  if (error) throw error
  const rows: ProjectSettingsMember[] = (data ?? []).map((d: any) => ({
    user_id: d.user_id,
    role: d.role,
    full_name: d.profiles?.full_name ?? null,
    avatar_url: d.profiles?.avatar_url ?? null,
    email: d.profiles?.email ?? '',
  }))

  queryCache.set(cacheKey, rows, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  return rows
}

export function prefetchProjectSettingsData(projectId: string): void {
  if (!projectId) return
  fetchProjectSettingsData(projectId).catch(() => {})
}

// ---------------------------------------------------------------------------
// 7. Account Settings Cache, Fetcher & Prefetcher
// ---------------------------------------------------------------------------

export async function fetchNotificationPreferences(
  userId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number },
): Promise<NotificationPreferences | null> {
  const scopeVersion = queryCache.scopeVersion
  const cacheKey = `account_preferences:${userId}`

  if (!options?.forceRefresh) {
    const cached = queryCache.get<NotificationPreferences>(cacheKey)
    if (cached) return cached
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (data) {
    queryCache.set(cacheKey, data, options?.ttlMs ?? DEFAULT_TTL_MS, scopeVersion)
  }
  return data
}

export function prefetchAccountSettingsData(userId: string): void {
  if (!userId) return
  fetchNotificationPreferences(userId).catch(() => {})
}

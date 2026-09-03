import {
  ArrowLeft,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Clock,
  ExternalLink,
  Filter,
  FlaskConical,
  Inbox,
  Mail,
  MessageSquare,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchNotificationsData,
  invalidateNotificationsCache,
  prefetchProjectSettingsData,
  queryCache,
  type EnrichedNotificationItem,
} from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { NotificationType } from '../lib/database.types'

export type EnrichedNotification = EnrichedNotificationItem

const typeConfig: Record<
  NotificationType,
  { icon: typeof Bell; label: string; badgeClass: string; iconClass: string }
> = {
  ISSUE_ASSIGNED: {
    icon: UserPlus,
    label: 'Assigned',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    iconClass: 'text-blue-600',
  },
  READY_FOR_TESTING: {
    icon: FlaskConical,
    label: 'Testing Ready',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    iconClass: 'text-purple-600',
  },
  QA_PASSED: {
    icon: CircleCheck,
    label: 'QA Passed',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    iconClass: 'text-emerald-600',
  },
  QA_FAILED: {
    icon: XCircle,
    label: 'QA Failed',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    iconClass: 'text-rose-600',
  },
  ISSUE_DONE: {
    icon: CircleCheck,
    label: 'Completed',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    iconClass: 'text-emerald-600',
  },
  COMMENT_ADDED: {
    icon: MessageSquare,
    label: 'Comment',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    iconClass: 'text-primary',
  },
  INVITATION: {
    icon: Mail,
    label: 'Invitation',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    iconClass: 'text-amber-600',
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

type NotificationThread = {
  key: string
  sourceType: 'ISSUE' | 'INVITATION' | 'PROJECT' | 'GENERAL'
  sourceTitle: string
  sourceSubtitle: string | null
  projectKey: string | null
  projectName: string | null
  issueId: string | null
  unreadCount: number
  latestNotification: EnrichedNotification
  notifications: EnrichedNotification[]
}

function Notifications() {
  const { user } = useAuth()
  const { currentProject } = useProject()

  const [notifications, setNotifications] = useState<EnrichedNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false)
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null)

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!user) return

      const cacheKey = `notifications:${user.id}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached) {
        setLoading(true)
      }

      try {
        const data = await fetchNotificationsData(user.id, { forceRefresh })
        setNotifications(data)
      } finally {
        setLoading(false)
      }

      // Prefetch Project Settings while on Notifications page
      if (currentProject?.id) {
        prefetchProjectSettingsData(currentProject.id)
      }
    },
    [user, currentProject],
  )

  useEffect(() => {
    load()
  }, [load])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => load(true),
  })

  const markThreadAsRead = async (threadNotifs: EnrichedNotification[]) => {
    const unreadIds = threadNotifs.filter((n) => !n.is_read).map((n) => n.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) =>
        unreadIds.includes(n.id) ? { ...n, is_read: true, read_at: now } : n,
      ),
    )
    if (user?.id) invalidateNotificationsCache(user.id)
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: now })
      .in('id', unreadIds)
  }

  const markThreadAsUnread = async (threadNotifs: EnrichedNotification[]) => {
    const ids = threadNotifs.map((n) => n.id)
    if (ids.length === 0) return
    setNotifications((prev) =>
      prev.map((n) =>
        ids.includes(n.id) ? { ...n, is_read: false, read_at: null } : n,
      ),
    )
    if (user?.id) invalidateNotificationsCache(user.id)
    await supabase
      .from('notifications')
      .update({ is_read: false, read_at: null })
      .in('id', ids)
  }

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: now })),
    )
    if (user?.id) invalidateNotificationsCache(user.id)
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: now })
      .in('id', unreadIds)
  }

  // Group notifications into Messenger-like conversation threads
  const threads = useMemo<NotificationThread[]>(() => {
    const map = new Map<string, NotificationThread>()

    notifications.forEach((n) => {
      let key = ''
      let sourceType: NotificationThread['sourceType'] = 'GENERAL'
      let sourceTitle = ''
      let sourceSubtitle: string | null = null
      const projectKey = n.project?.key ?? null
      const projectName = n.project?.name ?? null
      const issueId = n.issue_id

      if (n.issue_id && n.issue) {
        key = `issue:${n.issue_id}`
        sourceType = 'ISSUE'
        sourceTitle = `${n.project?.key ?? 'ISSUE'}-${n.issue.issue_number}: ${n.issue.title}`
        sourceSubtitle = n.project?.name ?? null
      } else if (n.type === 'INVITATION') {
        key = `invitation:${n.project_id || 'invite'}`
        sourceType = 'INVITATION'
        sourceTitle = n.project ? `Invitations: ${n.project.name}` : 'Project Invitations'
        sourceSubtitle = 'Team access and membership invites'
      } else if (n.project_id && n.project) {
        key = `project:${n.project_id}`
        sourceType = 'PROJECT'
        sourceTitle = `Project: ${n.project.name}`
        sourceSubtitle = `[${n.project.key}] updates`
      } else {
        key = 'general'
        sourceType = 'GENERAL'
        sourceTitle = 'General Notifications'
        sourceSubtitle = null
      }

      if (!map.has(key)) {
        map.set(key, {
          key,
          sourceType,
          sourceTitle,
          sourceSubtitle,
          projectKey,
          projectName,
          issueId,
          unreadCount: 0,
          latestNotification: n,
          notifications: [],
        })
      }

      const thread = map.get(key)!
      thread.notifications.push(n)
      if (!n.is_read) {
        thread.unreadCount += 1
      }
      if (new Date(n.created_at) > new Date(thread.latestNotification.created_at)) {
        thread.latestNotification = n
      }
    })

    // Sort threads by latest notification timestamp (most recent thread at the top)
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.latestNotification.created_at).getTime() -
        new Date(a.latestNotification.created_at).getTime(),
    )
  }, [notifications])

  // Filtered threads
  const displayedThreads = useMemo(() => {
    if (filterUnreadOnly) {
      return threads.filter((t) => t.unreadCount > 0)
    }
    return threads
  }, [threads, filterUnreadOnly])

  const totalUnreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  )

  const activeThread = useMemo(
    () => threads.find((t) => t.key === activeThreadKey) ?? null,
    [threads, activeThreadKey],
  )

  const handleOpenThread = (thread: NotificationThread) => {
    setActiveThreadKey(thread.key)
    if (thread.unreadCount > 0) {
      markThreadAsRead(thread.notifications)
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="mx-auto w-full max-w-[1024px] flex-1 px-lg py-lg">
        {/* Full-Page Thread View Mode */}
        {activeThread ? (
          <div className="flex flex-col gap-lg animate-in fade-in duration-150">
            {/* Navigation back button */}
            <div className="flex items-center justify-between border-b border-outline-variant pb-md">
              <button
                type="button"
                onClick={() => setActiveThreadKey(null)}
                className="flex items-center gap-xs text-body-lg font-semibold text-primary hover:underline"
              >
                <ArrowLeft size={18} />
                <span>Back to All Notifications</span>
              </button>

              <div className="flex items-center gap-sm">
                <button
                  type="button"
                  onClick={() => markThreadAsUnread(activeThread.notifications)}
                  className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-label-md font-semibold text-on-surface-variant hover:bg-surface-container"
                >
                  Mark thread as unread
                </button>
              </div>
            </div>

            {/* Thread Header Banner */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-sm">
              <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-sm">
                    <h1 className="text-headline-xl font-bold text-on-surface">
                      {activeThread.sourceTitle}
                    </h1>
                    {activeThread.projectKey && (
                      <span className="rounded-md border border-outline-variant bg-surface-container-low px-sm py-[2px] text-label-md font-bold text-on-surface">
                        {activeThread.projectKey}
                      </span>
                    )}
                  </div>
                  {activeThread.sourceSubtitle && (
                    <p className="mt-xs text-body-md text-on-surface-variant">
                      {activeThread.sourceSubtitle}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-xs">
                  <span className="rounded-full bg-surface-container-high px-md py-xs text-label-md font-semibold text-on-surface-variant">
                    {activeThread.notifications.length} total event
                    {activeThread.notifications.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </div>

            {/* Notification Cards Stream (Spacious Full Page Layout) */}
            <div className="flex flex-col gap-md">
              {activeThread.notifications
                .slice()
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                )
                .map((notif) => {
                  const typeInfo = typeConfig[notif.type]
                  const Icon = typeInfo.icon
                  const hasIssueRedirection = !!notif.issue_id
                  const hasInviteRedirection = notif.type === 'INVITATION'

                  return (
                    <div
                      key={notif.id}
                      className={`overflow-hidden rounded-xl border transition-all ${
                        notif.is_read
                          ? 'border-outline-variant bg-surface-container-lowest shadow-sm'
                          : 'border-primary/50 bg-primary-fixed/20 shadow-md ring-1 ring-primary/20'
                      }`}
                    >
                      <div className="p-lg">
                        {/* Card Header: Actor, Event Type badge, Timestamps */}
                        <div className="flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant/60 pb-md">
                          <div className="flex items-center gap-md">
                            <Avatar
                              name={notif.actor?.full_name}
                              avatarUrl={notif.actor?.avatar_url}
                              size={40}
                            />
                            <div>
                              <div className="flex items-center gap-sm">
                                <span className="text-body-lg font-bold text-on-surface">
                                  {notif.actor?.full_name ?? 'System'}
                                </span>
                                <span
                                  className={`flex items-center gap-xs rounded-full border px-sm py-[2px] text-label-md font-semibold ${typeInfo.badgeClass}`}
                                >
                                  <Icon size={12} className={typeInfo.iconClass} />
                                  <span>{typeInfo.label}</span>
                                </span>
                              </div>
                              <span className="flex items-center gap-xs text-label-md text-on-surface-variant">
                                <Clock size={12} />
                                <span>{new Date(notif.created_at).toLocaleString()}</span>
                                <span>({timeAgo(notif.created_at)})</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Card Content: Full Title & Message Body */}
                        <div className="pt-md">
                          <h3 className="text-headline-md font-semibold text-on-surface">
                            {notif.title}
                          </h3>

                          {notif.message ? (
                            <div className="mt-sm rounded-lg border border-outline-variant bg-surface-container-low/70 p-md text-body-lg text-on-surface whitespace-pre-wrap leading-relaxed">
                              {notif.message}
                            </div>
                          ) : (
                            <p className="mt-xs text-body-md text-on-surface-variant italic">
                              No additional note or comment body.
                            </p>
                          )}
                        </div>

                        {/* Card Footer: Contextual Specific Redirection (Only if applicable!) */}
                        {(hasIssueRedirection || hasInviteRedirection) && (
                          <div className="mt-lg flex items-center justify-end border-t border-outline-variant/60 pt-md">
                            {hasIssueRedirection ? (
                              <Link
                                to={`/issues/${notif.issue_id}`}
                                className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                              >
                                <span>View</span>
                                <ExternalLink size={14} />
                              </Link>
                            ) : (
                              hasInviteRedirection && (
                                <Link
                                  to="/projects/join"
                                  className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                                >
                                  <span>Respond to Invitation</span>
                                  <ExternalLink size={14} />
                                </Link>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        ) : (
          /* Main Thread Inbox View */
          <>
            {/* Header */}
            <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-sm">
                  <h1 className="text-headline-xl font-bold text-on-surface">
                    Notifications
                  </h1>
                  {totalUnreadCount > 0 && (
                    <span className="rounded-full bg-primary px-sm py-[2px] text-label-md font-semibold text-on-primary">
                      {totalUnreadCount} new
                    </span>
                  )}
                </div>
                <p className="mt-xs text-body-lg text-on-surface-variant">
                  {totalUnreadCount > 0
                    ? `You have ${totalUnreadCount} unread notification${totalUnreadCount === 1 ? '' : 's'}. Click any thread to review full details.`
                    : "You're all caught up."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-sm">
                <button
                  type="button"
                  onClick={() => setFilterUnreadOnly((v) => !v)}
                  className={`flex items-center gap-xs rounded-md border px-sm py-xs text-label-md font-semibold transition-colors ${
                    filterUnreadOnly
                      ? 'border-primary bg-primary-fixed text-on-primary-fixed'
                      : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  <Filter size={14} />
                  {filterUnreadOnly ? 'Unread Only' : 'Filter Unread'}
                </button>

                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={totalUnreadCount === 0}
                  className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50"
                >
                  <CheckCheck size={14} />
                  Mark all read
                </button>
              </div>
            </div>

            {/* Messenger-Style Conversation Thread List */}
            {loading ? (
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-lg text-on-surface-variant">
                Loading notifications…
              </div>
            ) : displayedThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-xl text-center shadow-sm">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-low text-outline">
                  <Inbox size={32} />
                </div>
                <div className="flex flex-col items-center gap-xs">
                  <h3 className="text-headline-md font-bold text-on-surface">
                    {filterUnreadOnly ? 'No unread notifications' : 'No notifications yet'}
                  </h3>
                  <p className="max-w-[480px] text-body-lg text-on-surface-variant leading-relaxed">
                    {filterUnreadOnly
                      ? "You've read all your notifications. You can view your previous notifications anytime."
                      : "When tasks are assigned, tested, or commented on, they'll appear here."}
                  </p>
                </div>
                {filterUnreadOnly && (
                  <button
                    type="button"
                    onClick={() => setFilterUnreadOnly(false)}
                    className="mt-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                  >
                    Show all notifications
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
                <div className="divide-y divide-outline-variant">
                  {displayedThreads.map((thread) => {
                    const latest = thread.latestNotification
                    const latestType = typeConfig[latest.type]
                    const Icon = latestType.icon
                    const hasUnread = thread.unreadCount > 0

                    // Format snippet: "<ActorName>: <Message or Title>"
                    const actorName = latest.actor?.full_name ?? 'System'
                    const snippetText = latest.message || latest.title
                    const previewSnippet = `${actorName}: ${snippetText}`

                    return (
                      <div
                        key={thread.key}
                        onClick={() => handleOpenThread(thread)}
                        className={`group flex cursor-pointer items-center justify-between gap-md p-md transition-colors ${
                          hasUnread
                            ? 'bg-primary-fixed/20 hover:bg-primary-fixed/30'
                            : 'hover:bg-surface-container-low'
                        }`}
                      >
                        {/* Avatar + Thread Name + Preview Snippet in Front */}
                        <div className="flex min-w-0 flex-1 items-center gap-md">
                          <div className="relative shrink-0">
                            <Avatar
                              name={latest.actor?.full_name}
                              avatarUrl={latest.actor?.avatar_url}
                              size={44}
                              className={hasUnread ? 'ring-2 ring-primary' : ''}
                            />
                            <div
                              className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-surface-container-lowest shadow-sm ${latestType.badgeClass}`}
                            >
                              <Icon size={10} className={latestType.iconClass} />
                            </div>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-sm">
                              <div className="flex min-w-0 items-center gap-xs">
                                {hasUnread && (
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                                )}
                                <span
                                  className={`truncate text-body-lg ${
                                    hasUnread
                                      ? 'font-bold text-on-surface'
                                      : 'font-semibold text-on-surface'
                                  }`}
                                >
                                  {thread.sourceTitle}
                                </span>
                                {thread.projectKey && (
                                  <span className="shrink-0 rounded bg-surface-container px-xs py-0.5 text-[11px] font-semibold text-on-surface-variant">
                                    {thread.projectKey}
                                  </span>
                                )}
                              </div>

                              <span className="shrink-0 text-label-md text-on-surface-variant">
                                {timeAgo(latest.created_at)}
                              </span>
                            </div>

                            <div className="mt-0.5 flex items-center justify-between gap-sm">
                              <p
                                className={`truncate text-body-md ${
                                  hasUnread
                                    ? 'font-medium text-on-surface'
                                    : 'text-on-surface-variant'
                                }`}
                              >
                                {previewSnippet}
                              </p>

                              <div className="flex shrink-0 items-center gap-xs">
                                {hasUnread && (
                                  <span className="rounded-full bg-primary px-sm py-[1px] text-[11px] font-bold text-on-primary">
                                    {thread.unreadCount} new
                                  </span>
                                )}
                                {thread.notifications.length > 1 && (
                                  <span className="rounded-md border border-outline-variant bg-surface-container-low px-xs py-[1px] text-[11px] font-medium text-on-surface-variant">
                                    {thread.notifications.length} updates
                                  </span>
                                )}
                                <ChevronRight
                                  size={16}
                                  className="text-outline transition-transform group-hover:translate-x-0.5"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Notifications

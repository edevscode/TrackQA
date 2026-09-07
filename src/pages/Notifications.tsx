import { ArrowLeft, CheckCheck, ExternalLink, Filter } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
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
  { label: string; badgeClass: string }
> = {
  ISSUE_ASSIGNED: {
    label: 'ASSIGNED',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface',
  },
  READY_FOR_TESTING: {
    label: 'READY FOR QA',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  QA_PASSED: {
    label: 'QA PASSED',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  QA_FAILED: {
    label: 'QA FAILED',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  },
  ISSUE_DONE: {
    label: 'CLOSED',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  },
  COMMENT_ADDED: {
    label: 'NOTE',
    badgeClass: 'border-outline-variant bg-surface-container-low text-on-surface',
  },
  INVITATION: {
    label: 'INVITE',
    badgeClass: 'border-primary/30 bg-primary-fixed/30 text-primary',
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
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    thread: NotificationThread
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    removed: EnrichedNotification[]
    ids: string[]
    timeoutId: ReturnType<typeof setTimeout>
  } | null>(null)

  const hasLoadedOnceRef = useRef(false)
  const pendingDeleteRef = useRef(pendingDelete)
  useEffect(() => {
    pendingDeleteRef.current = pendingDelete
  }, [pendingDelete])

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!user) return

      const cacheKey = `notifications:${user.id}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached && !hasLoadedOnceRef.current) {
        setLoading(true)
      }

      try {
        const data = await fetchNotificationsData(user.id, { forceRefresh })
        setNotifications(data)
        hasLoadedOnceRef.current = true
      } finally {
        setLoading(false)
      }

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

  const deleteThread = (threadNotifs: EnrichedNotification[]) => {
    const idsToDelete = threadNotifs.map((n) => n.id)
    if (idsToDelete.length === 0) return

    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeoutId)
      supabase.from('notifications').delete().in('id', pendingDeleteRef.current.ids)
    }

    const removedList = notifications.filter((n) => idsToDelete.includes(n.id))
    setNotifications((prev) => prev.filter((n) => !idsToDelete.includes(n.id)))

    if (activeThreadKey && threadNotifs.some((n) => n.id === threadNotifs[0]?.id)) {
      setActiveThreadKey(null)
    }

    const timeoutId = setTimeout(async () => {
      await supabase.from('notifications').delete().in('id', idsToDelete)
      if (user?.id) invalidateNotificationsCache(user.id)
      setPendingDelete(null)
    }, 4000)

    setPendingDelete({
      removed: removedList,
      ids: idsToDelete,
      timeoutId,
    })
  }

  const undoDelete = () => {
    if (!pendingDelete) return
    clearTimeout(pendingDelete.timeoutId)
    setNotifications((prev) => [...prev, ...pendingDelete.removed])
    setPendingDelete(null)
  }

  const threads = useMemo(() => {
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
        const prefix = projectKey ? `[${projectKey}-${n.issue.issue_number}]` : `#${n.issue.issue_number}`
        sourceTitle = `${prefix} ${n.issue.title}`
        sourceSubtitle = projectName
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
        key = `general:${n.id}`
        sourceType = 'GENERAL'
        sourceTitle = n.title
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

    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.latestNotification.created_at).getTime() -
        new Date(a.latestNotification.created_at).getTime(),
    )
  }, [notifications])

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

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {activeThread ? (
            /* Full-Page Thread View Mode */
            <div className="flex flex-col gap-md animate-in fade-in duration-100">
              <button
                type="button"
                onClick={() => setActiveThreadKey(null)}
                aria-label="Back to Notifications"
                className="flex w-fit items-center gap-xs font-mono text-code-xs font-semibold text-on-surface-variant hover:text-primary transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Return to Notifications Feed</span>
              </button>

              {/* Thread Header */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
                <div className="flex flex-wrap items-start justify-between gap-sm">
                  <div>
                    <h1 className="text-headline-md font-bold text-on-surface">
                      {activeThread.sourceTitle}
                    </h1>
                    {activeThread.sourceSubtitle && (
                      <p className="mt-xs font-mono text-code-xs text-on-surface-variant">
                        {activeThread.sourceSubtitle}
                      </p>
                    )}
                  </div>

                  <span className="font-mono text-code-xs text-outline">
                    {activeThread.notifications.length} AUDIT {activeThread.notifications.length === 1 ? 'EVENT' : 'EVENTS'}
                  </span>
                </div>
              </div>

              {/* Notification Stream */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">
                {activeThread.notifications
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                  )
                  .map((notif) => {
                    const hasIssueRedirection = !!notif.issue_id
                    const hasInviteRedirection = notif.type === 'INVITATION'
                    const typeInfo = typeConfig[notif.type]

                    return (
                      <div key={notif.id} className="flex gap-md p-md hover:bg-surface-container-low/50 transition-colors">
                        <Avatar
                          name={notif.actor?.full_name}
                          avatarUrl={notif.actor?.avatar_url}
                          size={36}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className="text-body-md font-semibold text-on-surface">
                              {notif.actor?.full_name ?? 'System'}
                            </span>
                            <span
                              className={`rounded border px-xs py-0.2 font-mono text-code-xs font-semibold uppercase ${typeInfo.badgeClass}`}
                            >
                              {typeInfo.label}
                            </span>
                            <span className="font-mono text-code-xs text-outline">
                              · {timeAgo(notif.created_at)}
                            </span>
                            {!notif.is_read && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            )}
                          </div>

                          <p className="mt-xs text-body-md text-on-surface">{notif.title}</p>

                          {notif.message && (
                            <p className="mt-xs whitespace-pre-wrap text-body-md text-on-surface-variant">
                              {notif.message}
                            </p>
                          )}

                          {(hasIssueRedirection || hasInviteRedirection) && (
                            <Link
                              to={hasIssueRedirection ? `/issues/${notif.issue_id}` : '/projects/join'}
                              className="mt-xs inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
                            >
                              <span>{hasIssueRedirection ? 'View issue' : 'View invitation'}</span>
                              <ExternalLink size={14} />
                            </Link>
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
              <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-xs">
                    <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                      Notifications
                    </h1>
                    {totalUnreadCount > 0 && (
                      <span className="rounded border border-primary/30 bg-primary-fixed/40 px-xs py-0.5 font-mono text-code-xs font-bold text-primary">
                        {totalUnreadCount} UNREAD
                      </span>
                    )}
                  </div>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Real-time verification alerts, issue updates, and project activity.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-xs sm:gap-sm">
                  <button
                    type="button"
                    onClick={() => setFilterUnreadOnly((v) => !v)}
                    className={`inline-flex items-center gap-xs rounded border px-sm py-xs text-label-md font-semibold transition-colors ${
                      filterUnreadOnly
                        ? 'border-primary bg-primary-fixed text-on-primary-fixed'
                        : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    <Filter size={14} />
                    <span>{filterUnreadOnly ? 'Showing Unread' : 'Filter Unread'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={markAllRead}
                    disabled={totalUnreadCount === 0}
                    className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
                  >
                    <CheckCheck size={14} />
                    <span>Mark All Read</span>
                  </button>
                </div>
              </div>

              {/* Feed Container */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
                {loading ? (
                  <div className="p-xl text-center text-body-md text-on-surface-variant font-mono">
                    Loading activity feeds…
                  </div>
                ) : displayedThreads.length === 0 ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center p-xl text-center">
                    <p className="text-headline-md font-semibold text-on-surface">
                      {filterUnreadOnly ? 'No unread notifications' : 'No notifications yet'}
                    </p>
                    <p className="mt-xs text-body-md text-on-surface-variant max-w-md">
                      {filterUnreadOnly
                        ? 'All notifications have been reviewed.'
                        : 'Verification outcomes, assignment changes, and comments will appear here.'}
                    </p>
                    {filterUnreadOnly && (
                      <button
                        type="button"
                        onClick={() => setFilterUnreadOnly(false)}
                        className="mt-xs text-label-md font-semibold text-primary hover:underline"
                      >
                        Show all activity
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-outline-variant">
                    {displayedThreads.map((thread) => {
                      const latest = thread.latestNotification
                      const hasUnread = thread.unreadCount > 0
                      const actorName = latest.actor?.full_name ?? 'System'
                      const snippetText = latest.message || latest.title
                      const typeInfo = typeConfig[latest.type]

                      return (
                        <div
                          key={thread.key}
                          onClick={() => handleOpenThread(thread)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setContextMenu({ x: e.clientX, y: e.clientY, thread })
                          }}
                          className={`flex cursor-pointer items-start gap-md p-md hover:bg-surface-container-low transition-colors ${
                            hasUnread ? 'bg-surface-container-lowest' : 'bg-surface-container-lowest/70'
                          }`}
                        >
                          <Avatar
                            name={latest.actor?.full_name}
                            avatarUrl={latest.actor?.avatar_url}
                            size={36}
                            className="shrink-0"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-xs">
                              {hasUnread && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                              )}
                              <span
                                className={`truncate text-body-md ${
                                  hasUnread ? 'font-bold text-on-surface' : 'font-medium text-on-surface'
                                }`}
                              >
                                {thread.sourceTitle}
                              </span>
                              <span
                                className={`shrink-0 rounded border px-xs py-0.2 font-mono text-code-xs font-semibold uppercase ${typeInfo.badgeClass}`}
                              >
                                {typeInfo.label}
                              </span>
                            </div>
                            <p
                              className={`mt-xs truncate text-body-md ${
                                hasUnread ? 'text-on-surface' : 'text-on-surface-variant'
                              }`}
                            >
                              <strong className="font-semibold">{actorName}</strong>: {snippetText}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-xs font-mono text-code-xs text-outline">
                            <span>{timeAgo(latest.created_at)}</span>
                            {hasUnread && (
                              <span className="flex h-5 min-w-[20px] items-center justify-center rounded border border-primary/30 bg-primary px-xs font-mono text-code-xs font-bold text-on-primary">
                                {thread.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="fixed z-50 w-44 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-sm"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              type="button"
              onClick={() => {
                markThreadAsUnread(contextMenu.thread.notifications)
                setContextMenu(null)
              }}
              className="block w-full px-sm py-xs text-left text-body-md text-on-surface hover:bg-surface-container transition-colors"
            >
              Mark as unread
            </button>
            <button
              type="button"
              onClick={() => {
                deleteThread(contextMenu.thread.notifications)
                setContextMenu(null)
              }}
              className="block w-full px-sm py-xs text-left text-body-md text-error hover:bg-rose-500/10 transition-colors"
            >
              Delete thread
            </button>
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="fixed bottom-lg left-1/2 z-50 flex -translate-x-1/2 items-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs shadow-sm">
          <span className="text-body-md text-on-surface">Thread removed from dispatch</span>
          <button
            type="button"
            onClick={undoDelete}
            className="font-mono text-code-xs font-semibold text-primary hover:underline"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

export default Notifications

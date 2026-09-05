import { ArrowLeft, CheckCheck, ExternalLink, Filter } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const typeConfig: Record<NotificationType, { label: string }> = {
  ISSUE_ASSIGNED: { label: 'Assigned' },
  READY_FOR_TESTING: { label: 'Testing Ready' },
  QA_PASSED: { label: 'QA Passed' },
  QA_FAILED: { label: 'QA Failed' },
  ISSUE_DONE: { label: 'Completed' },
  COMMENT_ADDED: { label: 'Comment' },
  INVITATION: { label: 'Invitation' },
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

      // Only the very first load (no data on screen yet) shows a loading
      // state. A realtime-triggered background refresh — including the one
      // fired by our own optimistic updates (mark read/unread, delete) —
      // should silently swap in fresh data with no visible flash.
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

  const commitDelete = async (ids: string[]) => {
    if (user?.id) invalidateNotificationsCache(user.id)
    await supabase.from('notifications').delete().in('id', ids)
  }

  // Optimistically hides the thread and holds the actual delete for a few
  // seconds so it can be undone. Only one pending delete is tracked at a
  // time — starting a new one commits whatever was already pending.
  const deleteThread = (threadNotifs: EnrichedNotification[]) => {
    const ids = threadNotifs.map((n) => n.id)
    if (ids.length === 0) return

    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeoutId)
      commitDelete(pendingDeleteRef.current.ids)
    }

    setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)))

    const timeoutId = setTimeout(() => {
      setPendingDelete(null)
      commitDelete(ids)
    }, 5000)

    setPendingDelete({ removed: threadNotifs, ids, timeoutId })
  }

  const undoDelete = () => {
    if (!pendingDelete) return
    clearTimeout(pendingDelete.timeoutId)
    setNotifications((prev) => [...prev, ...pendingDelete.removed])
    setPendingDelete(null)
  }

  // If the page is left before the undo window elapses, commit the pending
  // delete immediately rather than silently losing track of it.
  useEffect(() => {
    return () => {
      const pd = pendingDeleteRef.current
      if (pd) {
        clearTimeout(pd.timeoutId)
        commitDelete(pd.ids)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      <div className="w-full flex-1 py-lg">
        {/* Full-Page Thread View Mode */}
        {activeThread ? (
          <div className="flex flex-col gap-lg animate-in fade-in duration-150">
            <button
              type="button"
              onClick={() => setActiveThreadKey(null)}
              aria-label="Back to Notifications"
              className="mx-lg flex w-fit items-center text-on-surface-variant hover:text-primary"
            >
              <ArrowLeft size={24} />
            </button>

            {/* Thread Header */}
            <div className="border-y border-outline-variant p-lg">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div>
                  <div className="flex flex-wrap items-center gap-sm">
                    <h1 className="text-headline-lg font-bold text-on-surface">
                      {activeThread.sourceTitle}
                    </h1>
                    {activeThread.projectKey && (
                      <span className="text-label-md font-semibold text-on-surface-variant">
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

                <span className="shrink-0 text-body-md text-on-surface-variant">
                  {activeThread.notifications.length} event
                  {activeThread.notifications.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Notification Stream */}
            <div className="flex flex-col divide-y divide-outline-variant px-lg">
              {activeThread.notifications
                .slice()
                .sort(
                  (a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                )
                .map((notif) => {
                  const hasIssueRedirection = !!notif.issue_id
                  const hasInviteRedirection = notif.type === 'INVITATION'

                  return (
                    <div key={notif.id} className="flex gap-md py-lg first:pt-0">
                      <Avatar
                        name={notif.actor?.full_name}
                        avatarUrl={notif.actor?.avatar_url}
                        size={44}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-xs">
                          <span className="text-body-lg font-semibold text-on-surface">
                            {notif.actor?.full_name ?? 'System'}
                          </span>
                          <span className="text-body-md text-on-surface-variant">
                            {typeConfig[notif.type].label} · {timeAgo(notif.created_at)}
                          </span>
                          {!notif.is_read && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          )}
                        </div>

                        <p className="mt-xs text-body-lg text-on-surface">{notif.title}</p>

                        {notif.message && (
                          <p className="mt-xs whitespace-pre-wrap text-body-lg text-on-surface-variant">
                            {notif.message}
                          </p>
                        )}

                        {(hasIssueRedirection || hasInviteRedirection) && (
                          <Link
                            to={hasIssueRedirection ? `/issues/${notif.issue_id}` : '/projects/join'}
                            className="mt-sm inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
                          >
                            <span>{hasIssueRedirection ? 'View issue' : 'Respond to invitation'}</span>
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
            <div className="mb-lg flex flex-col gap-md px-lg sm:flex-row sm:items-center sm:justify-between">
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
              <div className="mx-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-lg text-on-surface-variant">
                Loading notifications…
              </div>
            ) : displayedThreads.length === 0 ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-xs px-lg text-center">
                <p className="text-body-lg font-semibold text-on-surface">
                  {filterUnreadOnly ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  {filterUnreadOnly
                    ? "You've read all your notifications. You can view your previous notifications anytime."
                    : "When tasks are assigned, tested, or commented on, they'll appear here."}
                </p>
                {filterUnreadOnly && (
                  <button
                    type="button"
                    onClick={() => setFilterUnreadOnly(false)}
                    className="mt-xs text-label-md font-semibold text-primary hover:underline"
                  >
                    Show all notifications
                  </button>
                )}
              </div>
            ) : (
              <div className="border-t border-outline-variant">
                {displayedThreads.map((thread) => {
                  const latest = thread.latestNotification
                  const hasUnread = thread.unreadCount > 0
                  const actorName = latest.actor?.full_name ?? 'System'
                  const snippetText = latest.message || latest.title

                  return (
                    <div
                      key={thread.key}
                      onClick={() => handleOpenThread(thread)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, thread })
                      }}
                      className={`flex cursor-pointer items-start gap-md border-b border-outline-variant px-lg py-lg hover:bg-surface-container-low ${
                        hasUnread ? 'bg-surface-container-lowest' : ''
                      }`}
                    >
                      <Avatar
                        name={latest.actor?.full_name}
                        avatarUrl={latest.actor?.avatar_url}
                        size={44}
                        className="shrink-0"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-sm">
                          {hasUnread && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                          <span
                            className={`truncate text-body-lg ${
                              hasUnread ? 'font-bold text-on-surface' : 'font-medium text-on-surface-variant'
                            }`}
                          >
                            {thread.sourceTitle}
                          </span>
                          {thread.projectKey && (
                            <span className="shrink-0 text-label-md text-on-surface-variant">
                              {thread.projectKey}
                            </span>
                          )}
                        </div>
                        <p
                          className={`truncate text-body-md ${
                            hasUnread ? 'text-on-surface' : 'text-on-surface-variant'
                          }`}
                        >
                          {actorName}: {snippetText}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-xs">
                        <span className="text-body-md text-on-surface-variant">
                          {timeAgo(latest.created_at)}
                        </span>
                        {hasUnread && (
                          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-xs text-[11px] font-bold text-on-primary">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
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
            className="fixed z-50 w-48 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-raised"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              type="button"
              onClick={() => {
                markThreadAsUnread(contextMenu.thread.notifications)
                setContextMenu(null)
              }}
              className="block w-full px-md py-sm text-left text-body-md text-on-surface hover:bg-surface-container-low"
            >
              Mark as unread
            </button>
            <button
              type="button"
              onClick={() => {
                deleteThread(contextMenu.thread.notifications)
                setContextMenu(null)
              }}
              className="block w-full px-md py-sm text-left text-body-md text-error hover:bg-error-container"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="fixed bottom-lg left-1/2 z-50 flex -translate-x-1/2 items-center gap-md rounded-md bg-inverse-surface px-md py-sm shadow-raised">
          <span className="text-body-md text-inverse-on-surface">Notification deleted</span>
          <button
            type="button"
            onClick={undoDelete}
            className="text-body-md font-semibold text-inverse-primary hover:underline"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

export default Notifications

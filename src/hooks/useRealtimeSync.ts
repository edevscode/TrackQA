import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  invalidateProjectCache,
  invalidateMembersCache,
  invalidateNotificationsCache,
  invalidateAccountSettingsCache,
  invalidateMyTasksCache,
} from '../lib/cache'

export interface RealtimeSyncOptions {
  projectId?: string | null
  userId?: string | null
  issueId?: string | null
  onRefresh?: () => void | Promise<void>
}

/**
 * useRealtimeSync
 *
 * Automatically subscribes to Supabase Realtime changes for:
 * - Current Project (issues, members, invitations, project details)
 * - Current User (notifications, notification preferences)
 * - Specific Issue (comments, activities, QA verifications)
 *
 * When changes occur anywhere in the database (even from another tab or team member):
 * 1. Invalidates matching in-memory cache entries immediately.
 * 2. Debounces and calls `onRefresh` to update active page state in real-time.
 */
export function useRealtimeSync({
  projectId,
  userId,
  issueId,
  onRefresh,
}: RealtimeSyncOptions): void {
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerRefresh = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      onRefreshRef.current?.()
    }, 120)
  }

  // 1. Project-level Realtime Subscription
  useEffect(() => {
    if (!projectId) return

    const channelName = `realtime:project:${projectId}:${Math.random().toString(36).slice(2, 7)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'issues',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          invalidateProjectCache(projectId)
          invalidateMyTasksCache(projectId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_members',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          invalidateMembersCache(projectId)
          invalidateProjectCache(projectId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_invitations',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          invalidateMembersCache(projectId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `id=eq.${projectId}`,
        },
        () => {
          invalidateProjectCache(projectId)
          triggerRefresh()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // 2. User-level Realtime Subscription
  useEffect(() => {
    if (!userId) return

    const channelName = `realtime:user:${userId}:${Math.random().toString(36).slice(2, 7)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          invalidateNotificationsCache(userId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notification_preferences',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          invalidateAccountSettingsCache(userId)
          triggerRefresh()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  // 3. Issue-level Realtime Subscription (for IssueDetail)
  useEffect(() => {
    if (!issueId) return

    const channelName = `realtime:issue:${issueId}:${Math.random().toString(36).slice(2, 7)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'issue_comments',
          filter: `issue_id=eq.${issueId}`,
        },
        () => {
          if (projectId) invalidateProjectCache(projectId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'issue_activity',
          filter: `issue_id=eq.${issueId}`,
        },
        () => {
          if (projectId) invalidateProjectCache(projectId)
          triggerRefresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'qa_verifications',
          filter: `issue_id=eq.${issueId}`,
        },
        () => {
          if (projectId) invalidateProjectCache(projectId)
          triggerRefresh()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [issueId, projectId])

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])
}

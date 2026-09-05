import { Archive, Bell, Check, ChevronDown, HelpCircle, Plus, Search, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { supabase } from '../lib/supabase'

function TopBar() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const { projects, currentProject, setCurrentProjectId } = useProject()

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [hasPendingInvite, setHasPendingInvite] = useState(false)

  const loadUnreadCount = useCallback(async () => {
    if (!user) return
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
    setUnreadCount(count ?? 0)
  }, [user])

  useEffect(() => {
    loadUnreadCount()
  }, [loadUnreadCount])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: loadUnreadCount,
  })

  useEffect(() => {
    if (!user?.email) return
    supabase
      .from('project_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('email', user.email.toLowerCase())
      .eq('status', 'PENDING')
      .then(({ count }) => setHasPendingInvite(!!count && count > 0))
  }, [user?.email])

  return (
    <header className="flex items-center gap-sm border-b border-outline-variant bg-surface-container-lowest py-md pl-[64px] pr-lg lg:gap-md lg:px-lg">
      <div className="hidden min-w-0 flex-1 items-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm md:flex">
        <Search className="text-outline" size={18} />
        <input
          type="text"
          placeholder="Search issues, projects..."
          className="flex-1 bg-transparent text-body-lg text-on-surface outline-none placeholder:text-outline"
        />
        <kbd className="rounded-sm border border-outline-variant bg-surface-container-low px-xs text-label-md text-on-surface-variant">
          ⌘
        </kbd>
        <kbd className="rounded-sm border border-outline-variant bg-surface-container-low px-xs text-label-md text-on-surface-variant">
          K
        </kbd>
      </div>

      <div className="flex-1 md:hidden" />

      <button
        type="button"
        aria-label="Notifications"
        onClick={() => navigate('/notifications')}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[11px] font-bold text-on-error shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label="Help"
        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low md:flex"
      >
        <HelpCircle size={20} />
      </button>

      <div className="hidden h-8 w-px shrink-0 bg-outline-variant md:block" />

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setProjectMenuOpen((v) => !v)}
          className="relative flex items-center gap-sm rounded-md border border-outline-variant px-md py-sm text-body-md font-medium text-on-surface hover:bg-surface-container-low"
        >
          <span className="max-w-[100px] truncate sm:max-w-[200px] lg:max-w-[260px] xl:max-w-[360px]">
            {currentProject?.name ?? 'Select project'}
          </span>
          <ChevronDown size={16} className="shrink-0" />
          {hasPendingInvite && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-error" />
          )}
        </button>

        {projectMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setProjectMenuOpen(false)}
            />
            <div className="absolute right-0 z-20 mt-xs w-[280px] rounded-lg border border-outline-variant bg-surface-container-lowest py-xs shadow-raised animate-in fade-in zoom-in-95 duration-100">
              {projects.map((project) => {
                const isOwner = Boolean(user?.id && project.owner_id === user.id)
                const isSelected = project.id === currentProject?.id

                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setCurrentProjectId(project.id)
                      setProjectMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between gap-sm px-md py-sm text-left text-body-md transition-colors ${
                      isSelected
                        ? 'bg-surface-container-low font-semibold text-on-surface'
                        : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-xs">
                      <span className="truncate">
                        {project.name}{' '}
                        <span className="text-on-surface-variant font-normal">
                          ({project.key})
                        </span>
                      </span>
                      {isOwner && (
                        <span className="shrink-0 rounded bg-primary-fixed px-xs py-0.5 text-[10px] font-bold text-on-primary-fixed uppercase tracking-wider">
                          My Project
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="text-primary shrink-0" size={16} />
                    )}
                  </button>
                )
              })}

              <div className="my-xs border-t border-outline-variant" />

              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false)
                  navigate('/projects/new')
                }}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-body-md font-medium text-primary hover:bg-surface-container-low"
              >
                <Plus size={16} />
                Create Project
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false)
                  navigate('/projects/join')
                }}
                className="relative flex w-full items-center gap-sm px-md py-sm text-left text-body-md font-medium text-primary hover:bg-surface-container-low"
              >
                <UserPlus size={16} />
                Join a Project
                {hasPendingInvite && (
                  <span className="h-2 w-2 rounded-full bg-error" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false)
                  navigate('/projects/archived')
                }}
                className="flex w-full items-center gap-sm px-md py-sm text-left text-body-md font-medium text-on-surface-variant hover:bg-surface-container-low"
              >
                <Archive size={16} />
                Archived Projects
              </button>
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate('/account-settings')}
        aria-label="Account settings"
        className="rounded-full"
      >
        <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={40} />
      </button>
    </header>
  )
}

export default TopBar

import {
  Archive,
  ArrowRight,
  Bell,
  Bug,
  Check,
  ChevronDown,
  CircleCheck,
  HelpCircle,
  LayoutGrid,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Users,
  UserPlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useSidebar } from '../contexts/SidebarContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { supabase } from '../lib/supabase'
import type { IssuePriority, IssueStatus } from '../lib/database.types'

interface IssueSearchResult {
  id: string
  issue_number: number
  title: string
  status: IssueStatus
  priority: IssuePriority
}

function TopBar() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const { projects, currentProject, setCurrentProjectId } = useProject()
  const { collapsed, toggleCollapsed, toggleMobileOpen } = useSidebar()

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [hasPendingInvite, setHasPendingInvite] = useState(false)

  // Direct Search State
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<IssueSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Universal Modifier Key (⌘ on Mac, Ctrl on Windows/Linux)
  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  const modKey = isMac ? '⌘' : 'Ctrl'

  // Global Hotkey: Focus searchbar on Ctrl+K / Cmd+K or /
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      const isInputActive =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        setSearchFocused(true)
      } else if (e.key === '/' && !isInputActive) {
        e.preventDefault()
        searchInputRef.current?.focus()
        setSearchFocused(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchFocused(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Realtime search issues in current project
  useEffect(() => {
    if (!currentProject || !searchQuery.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)

    const timer = setTimeout(async () => {
      const q = searchQuery.trim()
      const issueNum = parseInt(q.replace(/^[^\d]*/, ''), 10)

      let builder = supabase
        .from('issues')
        .select('id, issue_number, title, status, priority')
        .eq('project_id', currentProject.id)

      if (!isNaN(issueNum) && issueNum > 0) {
        builder = builder.or(`title.ilike.%${q}%,issue_number.eq.${issueNum}`)
      } else {
        builder = builder.ilike('title', `%${q}%`)
      }

      const { data } = await builder.order('updated_at', { ascending: false }).limit(6)

      if (active) {
        setSearchResults((data as IssueSearchResult[]) ?? [])
        setSearching(false)
      }
    }, 150)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [searchQuery, currentProject])

  const staticNavActions = useMemo(
    () => [
      {
        id: 'new-issue',
        label: 'Create New Issue',
        icon: Plus,
        keywords: 'new create bug report task',
        action: () => navigate('/issues/new'),
      },
      {
        id: 'nav-dashboard',
        label: 'Dashboard & Issue Progress',
        icon: LayoutGrid,
        keywords: 'dashboard metrics pipeline stats overview progress',
        action: () => navigate('/dashboard'),
      },
      {
        id: 'nav-issues',
        label: 'Issues Backlog',
        icon: Bug,
        keywords: 'issues bugs tickets list tasks',
        action: () => navigate('/issues'),
      },
      {
        id: 'nav-mytasks',
        label: 'My Assigned Tasks',
        icon: CircleCheck,
        keywords: 'tasks assigned to me work',
        action: () => navigate('/my-tasks'),
      },
      {
        id: 'nav-members',
        label: 'Team Members & Roles',
        icon: Users,
        keywords: 'members team users invites roles permissions',
        action: () => navigate('/members'),
      },
      {
        id: 'nav-settings',
        label: 'Project Settings',
        icon: Settings,
        keywords: 'settings project config repo prefix archive',
        action: () => navigate('/project-settings'),
      },
      {
        id: 'nav-support',
        label: 'Support & Documentation',
        icon: HelpCircle,
        keywords: 'support help docs faqs shortcuts ticket contact',
        action: () => navigate('/support'),
      },
    ],
    [navigate],
  )

  const filteredNavActions = useMemo(() => {
    if (!searchQuery.trim()) return staticNavActions
    const q = searchQuery.toLowerCase().trim()
    return staticNavActions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.keywords.includes(q),
    )
  }, [searchQuery, staticNavActions])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase().trim()
    return projects.filter(
      (p) =>
        p.id !== currentProject?.id &&
        (p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)),
    )
  }, [searchQuery, projects, currentProject])

  // Flattened items for keyboard navigation
  const allResults = useMemo(() => {
    const list: { id: string; execute: () => void }[] = []

    searchResults.forEach((issue) => {
      list.push({
        id: `issue-${issue.id}`,
        execute: () => navigate(`/issues/${issue.id}`),
      })
    })

    filteredNavActions.forEach((item) => {
      list.push({
        id: item.id,
        execute: item.action,
      })
    })

    filteredProjects.forEach((proj) => {
      list.push({
        id: `proj-${proj.id}`,
        execute: () => {
          setCurrentProjectId(proj.id)
          navigate('/dashboard')
        },
      })
    })

    return list
  }, [searchResults, filteredNavActions, filteredProjects, navigate, setCurrentProjectId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!searchFocused) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(allResults.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + allResults.length) % Math.max(allResults.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (allResults[selectedIndex]) {
        allResults[selectedIndex].execute()
        setSearchFocused(false)
        searchInputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSearchFocused(false)
      searchInputRef.current?.blur()
    }
  }

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

  const handleToggleSidebar = () => {
    if (window.innerWidth < 1024) {
      toggleMobileOpen()
    } else {
      toggleCollapsed()
    }
  }

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-sm border-b border-outline-variant bg-surface-container-lowest py-sm px-md lg:gap-md lg:px-lg">
      {/* Left side: Sidebar Toggle + Direct Search Bar */}
      <div className="flex flex-1 items-center gap-sm min-w-0 max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {/* Sidebar Retract/Expand Toggle Button */}
        <button
          type="button"
          onClick={handleToggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? `Expand sidebar (${modKey}+B)` : `Collapse sidebar (${modKey}+B)`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
        >
          <PanelLeft size={20} className={collapsed ? 'text-primary' : 'text-on-surface-variant'} />
        </button>

        {/* Direct Search Input with Attached Dropdown */}
        <div
          ref={searchContainerRef}
          className="relative flex-1 min-w-[280px] sm:min-w-[360px] md:min-w-[480px] max-w-[760px] xl:max-w-[880px]"
          style={{ minWidth: '280px', maxWidth: '880px' }}
        >
          <div
            onClick={() => searchInputRef.current?.focus()}
            className={`flex h-10 w-full items-center gap-2.5 rounded-lg border px-3 cursor-text transition-all ${
              searchFocused
                ? 'border-primary bg-surface-container-lowest ring-2 ring-primary/15 shadow-sm'
                : 'border-outline-variant bg-surface-container-low/60 hover:border-outline hover:bg-surface-container-low'
            }`}
          >
            <Search
              className={`shrink-0 transition-colors ${searchFocused ? 'text-primary' : 'text-on-surface-variant'}`}
              size={18}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSelectedIndex(0)
              }}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={handleKeyDown}
              placeholder="Search issues, projects, pages..."
              className="w-full flex-1 min-w-[140px] bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/60"
              style={{ minWidth: '140px' }}
            />

            {searchQuery ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setSearchQuery('')
                  setSelectedIndex(0)
                  searchInputRef.current?.focus()
                }}
                className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors shrink-0"
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            ) : (
              <div className="hidden items-center gap-1 font-mono sm:flex shrink-0 select-none pointer-events-none">
                <kbd className="rounded border border-outline-variant/80 bg-surface-container-lowest px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant shadow-2xs">
                  {modKey}
                </kbd>
                <kbd className="rounded border border-outline-variant/80 bg-surface-container-lowest px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant shadow-2xs">
                  K
                </kbd>
              </div>
            )}
          </div>

          {/* Attached Direct Dropdown Menu */}
          {searchFocused && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-full max-h-[70vh] overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-sm shadow-2xl animate-in fade-in-50 slide-in-from-top-1 duration-150">
              {searching && (
                <div className="flex items-center justify-center py-md text-body-md text-on-surface-variant">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                  Searching issues…
                </div>
              )}

              {/* Matching Issues */}
              {searchResults.length > 0 && (
                <div className="mb-sm">
                  <div className="px-sm py-xs text-label-md font-bold uppercase tracking-wider text-on-surface-variant">
                    Issues in [{currentProject?.key}]
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {searchResults.map((issue) => {
                      const globalIdx = allResults.findIndex((r) => r.id === `issue-${issue.id}`)
                      const isSelected = selectedIndex === globalIdx
                      return (
                        <button
                          key={issue.id}
                          type="button"
                          onClick={() => {
                            navigate(`/issues/${issue.id}`)
                            setSearchFocused(false)
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          className={`flex w-full items-center justify-between rounded-md px-sm py-1.5 text-left transition-colors ${
                            isSelected
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface hover:bg-surface-container-low'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-sm">
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-code-xs font-bold ${
                                isSelected
                                  ? 'bg-on-primary/20 text-on-primary'
                                  : 'bg-primary-fixed text-on-primary-fixed'
                              }`}
                            >
                              {currentProject?.key}-{issue.issue_number}
                            </span>
                            <span className="truncate text-body-md font-medium">{issue.title}</span>
                          </div>
                          <span
                            className={`text-label-md shrink-0 uppercase tracking-wider ${
                              isSelected ? 'text-on-primary/80' : 'text-on-surface-variant'
                            }`}
                          >
                            {issue.status}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Switch Project */}
              {filteredProjects.length > 0 && (
                <div className="mb-sm">
                  <div className="px-sm py-xs text-label-md font-bold uppercase tracking-wider text-on-surface-variant">
                    Switch Project
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filteredProjects.map((proj) => {
                      const globalIdx = allResults.findIndex((r) => r.id === `proj-${proj.id}`)
                      const isSelected = selectedIndex === globalIdx
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => {
                            setCurrentProjectId(proj.id)
                            navigate('/dashboard')
                            setSearchFocused(false)
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          className={`flex w-full items-center justify-between rounded-md px-sm py-1.5 text-left transition-colors ${
                            isSelected
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface hover:bg-surface-container-low'
                          }`}
                        >
                          <div className="flex items-center gap-sm">
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-code-xs font-bold ${
                                isSelected
                                  ? 'bg-on-primary/20 text-on-primary'
                                  : 'bg-surface-container text-on-surface'
                              }`}
                            >
                              [{proj.key}]
                            </span>
                            <span className="text-body-md font-medium">{proj.name}</span>
                          </div>
                          <span
                            className={`text-label-md ${
                              isSelected ? 'text-on-primary/80' : 'text-on-surface-variant'
                            }`}
                          >
                            Switch
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Quick Actions & Navigation */}
              {filteredNavActions.length > 0 && (
                <div>
                  <div className="px-sm py-xs text-label-md font-bold uppercase tracking-wider text-on-surface-variant">
                    {searchQuery.trim() ? 'Actions & Pages' : 'Quick Actions'}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filteredNavActions.map((item) => {
                      const globalIdx = allResults.findIndex((r) => r.id === item.id)
                      const isSelected = selectedIndex === globalIdx
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            item.action()
                            setSearchFocused(false)
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                          className={`flex w-full items-center justify-between rounded-md px-sm py-1.5 text-left transition-colors ${
                            isSelected
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface hover:bg-surface-container-low'
                          }`}
                        >
                          <div className="flex items-center gap-sm">
                            <Icon
                              size={16}
                              className={isSelected ? 'text-on-primary' : 'text-on-surface-variant'}
                            />
                            <span className="text-body-md font-medium">{item.label}</span>
                          </div>
                          <ArrowRight
                            size={14}
                            className={isSelected ? 'text-on-primary' : 'text-outline'}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {searchQuery.trim() &&
                searchResults.length === 0 &&
                filteredProjects.length === 0 &&
                filteredNavActions.length === 0 &&
                !searching && (
                  <div className="py-md text-center">
                    <p className="text-body-md font-medium text-on-surface">
                      No results for &ldquo;{searchQuery}&rdquo;
                    </p>
                    <p className="text-code-xs text-on-surface-variant">
                      Try searching by issue number, defect title, or page name.
                    </p>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* Right side: Notifications, Project Switcher, Avatar */}
      <div className="flex items-center gap-xs sm:gap-sm shrink-0">
        {/* Notifications Button */}
        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          onClick={() => navigate('/notifications')}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-label-md font-bold text-on-error shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <div className="hidden h-8 w-px shrink-0 bg-outline-variant md:block" />

        {/* Project Switcher Menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setProjectMenuOpen((v) => !v)}
            className="relative flex items-center gap-sm rounded-md border border-outline-variant px-md py-sm text-body-md font-medium text-on-surface hover:bg-surface-container-low"
          >
            <span className="max-w-[100px] truncate sm:max-w-[200px] lg:max-w-[260px]">
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
                className="fixed inset-0 z-40"
                onClick={() => setProjectMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-xs w-64 rounded-md border border-outline-variant bg-surface-container-lowest py-xs shadow-lg">
                <div className="border-b border-outline-variant px-md py-xs text-label-md font-semibold text-on-surface-variant">
                  Projects
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {projects.map((p) => {
                    const isSelected = p.id === currentProject?.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setCurrentProjectId(p.id)
                          setProjectMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between px-md py-sm text-left text-body-md text-on-surface hover:bg-surface-container-low"
                      >
                        <div className="flex min-w-0 items-center gap-sm">
                          <span className="font-mono text-code-sm text-on-surface-variant">
                            [{p.key}]
                          </span>
                          <span className="truncate">{p.name}</span>
                        </div>
                        {isSelected && (
                          <Check size={16} className="text-primary shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>

                <div className="border-t border-outline-variant pt-xs" />
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
          title="Account settings"
          aria-label="Account settings"
          className="rounded-full"
        >
          <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={40} />
        </button>
      </div>
    </header>
  )
}

export default TopBar

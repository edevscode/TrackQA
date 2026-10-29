import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, ProjectRole } from '../lib/database.types'
import { canReportIssues as roleCanReportIssues } from '../lib/permissions'
import { useAuth } from './AuthContext'

interface ProjectContextValue {
  projects: Project[]
  currentProject: Project | null
  currentRole: ProjectRole | null
  canReportIssues: boolean
  loading: boolean
  error: string | null
  setCurrentProjectId: (id: string) => void
  refreshProjects: () => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)

const STORAGE_KEY = 'trackqa:currentProjectId'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [roles, setRoles] = useState<{ userId: string; byProject: Record<string, ProjectRole> } | null>(null)
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const refreshProjects = useCallback(async (background = false) => {
    const version = ++requestVersion.current
    if (!session) {
      setProjects([])
      setRoles(null)
      setLoading(false)
      return
    }
    if (!background) setLoading(true)
    setError(null)
    try {

      // Deliberately goes through project_members rather than a direct
      // `select * from projects` — the projects table's RLS also allows a
      // pending (not-yet-accepted) invitee to see the project row, which is
      // needed for /projects/join to show its name, but must NOT make the
      // project appear in "my projects" before they've actually accepted.
      // project_members is real membership, so joining through it is the
      // only reliable source of truth for that.
      const fetchMemberships = () =>
        supabase
          .from('project_members')
          .select('role, project_id, project:projects(*)')
          .eq('user_id', session.user.id)

      let { data, error } = await fetchMemberships()

      if (error) {
        // Validate the session before one retry. Network failures stay visible
        // rather than signing out or being interpreted as an empty workspace.
        const { data: userData } = await supabase.auth.getUser()

        if (!userData.user) {
          throw error
        }

        // Session was actually still valid (or just got refreshed) — retry once.
        ;({ data, error } = await fetchMemberships())
      }
      if (error) throw error
      if (version !== requestVersion.current) return

      const list = (data ?? [])
        .map((row) => row.project)
        .filter((p): p is Project => !!p && !p.archived)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setProjects(list)
      setRoles({ userId: session.user.id, byProject: Object.fromEntries((data ?? []).map((row) => [row.project_id, row.role])) })

      setCurrentProjectIdState((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        return list[0]?.id ?? null
      })

    } catch {
      if (version === requestVersion.current) setError('Unable to load your projects. Check your connection and retry.')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [session])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    if (!session?.user.id) return
    const channel = supabase.channel(`project-permissions:${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `user_id=eq.${session.user.id}` },
        () => { void refreshProjects(true) })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void refreshProjects(true) })
    // Refresh after returning to the tab, including missed Realtime events.
    const onFocus = () => { void refreshProjects(true) }
    window.addEventListener('focus', onFocus)
    return () => {
      void supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
    }
  }, [session?.user.id, refreshProjects])

  const setCurrentProjectId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setCurrentProjectIdState(id)
  }, [])

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null
  const currentRole = currentProject && roles?.userId === session?.user.id
    ? roles?.byProject[currentProject.id] ?? null : null

  return (
    <ProjectContext.Provider
      value={{ projects, currentProject, currentRole, canReportIssues: roleCanReportIssues(currentRole), loading, error, setCurrentProjectId, refreshProjects }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return ctx
}

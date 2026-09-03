import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/database.types'
import { useAuth } from './AuthContext'

interface ProjectContextValue {
  projects: Project[]
  currentProject: Project | null
  loading: boolean
  setCurrentProjectId: (id: string) => void
  refreshProjects: () => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)

const STORAGE_KEY = 'trackqa:currentProjectId'

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)

  const refreshProjects = useCallback(async () => {
    if (!session) {
      setProjects([])
      setLoading(false)
      return
    }
    setLoading(true)

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
        .select('project:projects(*)')
        .eq('user_id', session.user.id)

    let { data, error } = await fetchMemberships()

    if (error) {
      // A failed query while we believe we have a session almost always
      // means the access token expired without the background auto-refresh
      // catching it (e.g. the tab was backgrounded, which browsers throttle
      // timers on). getUser() always validates against the server rather
      // than trusting the locally cached session, refreshing the token if
      // it still can.
      const { data: userData } = await supabase.auth.getUser()

      if (!userData.user) {
        // Genuinely dead session — sign out so ProtectedRoute redirects to
        // /login. Leaving this as a failed fetch would make RequireProject
        // misread "fetch failed" as "no projects yet" and send a returning
        // user to /welcome, which is meant for brand-new users only.
        await supabase.auth.signOut()
        setLoading(false)
        return
      }

      // Session was actually still valid (or just got refreshed) — retry once.
      ;({ data, error } = await fetchMemberships())
    }

    const list = (data ?? [])
      .map((row) => row.project)
      .filter((p): p is Project => !!p && !p.archived)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    setProjects(list)

    setCurrentProjectIdState((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev
      return list[0]?.id ?? null
    })

    setLoading(false)
  }, [session])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  const setCurrentProjectId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setCurrentProjectIdState(id)
  }

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null

  return (
    <ProjectContext.Provider
      value={{ projects, currentProject, loading, setCurrentProjectId, refreshProjects }}
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

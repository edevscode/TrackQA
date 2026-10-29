import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/database.types'
import { useAuth } from './AuthContext'

interface ProjectContextValue {
  projects: Project[]
  currentProject: Project | null
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
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    if (!session) {
      setProjects([])
      setLoading(false)
      return
    }
    setLoading(true)
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
          .select('project:projects(*)')
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

      const list = (data ?? [])
        .map((row) => row.project)
        .filter((p): p is Project => !!p && !p.archived)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setProjects(list)

      setCurrentProjectIdState((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        return list[0]?.id ?? null
      })

    } catch {
      setError('Unable to load your projects. Check your connection and retry.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  const setCurrentProjectId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setCurrentProjectIdState(id)
  }, [])

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null

  return (
    <ProjectContext.Provider
      value={{ projects, currentProject, loading, error, setCurrentProjectId, refreshProjects }}
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

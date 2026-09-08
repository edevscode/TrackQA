import {
  ArchiveRestore,
  ArrowLeft,
  Calendar,
  LogOut,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/database.types'

interface ArchivedProjectItem extends Project {
  member_count?: number
}

function formatDate(iso: string | null) {
  if (!iso) return 'Archived'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ArchivedProjects() {
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
  const { currentProject, refreshProjects, setCurrentProjectId } = useProject()

  const [archivedList, setArchivedList] = useState<ArchivedProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    variant: 'danger' | 'warning' | 'primary'
    icon?: ReactNode
    isLoading?: boolean
    onConfirm: () => void | Promise<void>
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    onConfirm: () => {},
  })

  const loadArchivedProjects = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setActionError(null)

    const { data, error } = await supabase
      .from('project_members')
      .select('project:projects(*)')
      .eq('user_id', user.id)

    if (error) {
      setActionError(error.message)
      setLoading(false)
      return
    }

    const projects = (data ?? [])
      .map((row) => row.project)
      .filter((p): p is Project => !!p && p.archived === true)
      .sort((a, b) => {
        const timeA = a.archived_at ? new Date(a.archived_at).getTime() : 0
        const timeB = b.archived_at ? new Date(b.archived_at).getTime() : 0
        return timeB - timeA
      })

    // Fetch member counts for these projects
    const enriched: ArchivedProjectItem[] = await Promise.all(
      projects.map(async (proj) => {
        const { count } = await supabase
          .from('project_members')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', proj.id)
        return { ...proj, member_count: count ?? 1 }
      }),
    )

    setArchivedList(enriched)
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadArchivedProjects()
  }, [loadArchivedProjects])

  const handleRestore = async (project: ArchivedProjectItem) => {
    setRestoringId(project.id)
    setActionError(null)
    setActionSuccess(null)

    const { error } = await supabase
      .from('projects')
      .update({ archived: false, archived_at: null })
      .eq('id', project.id)

    if (error) {
      setActionError(error.message)
      setRestoringId(null)
      return
    }

    await refreshProjects()
    setCurrentProjectId(project.id)
    navigate('/dashboard')
  }

  const handleDelete = (project: ArchivedProjectItem) => {
    setConfirmModal({
      open: true,
      title: 'Delete Project Permanently',
      description: `Are you sure you want to permanently delete "${project.name}"? All associated issues, comments, and attachments will be deleted forever. This action cannot be undone.`,
      confirmLabel: 'Delete Forever',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setDeletingId(project.id)
        setActionError(null)
        setActionSuccess(null)

        const { error } = await supabase.from('projects').delete().eq('id', project.id)

        setDeletingId(null)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setActionError(error.message)
          return
        }

        setActionSuccess(`Project "${project.name}" deleted.`)
        await refreshProjects()
        loadArchivedProjects()
      },
    })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const renderContent = () => (
    <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
      <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-xs">
            <span className="rounded bg-surface-container-highest px-xs py-0.5 font-mono text-code-xs font-bold text-on-surface tracking-wider">
              [COLD-STORAGE]
            </span>
            <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
              Archived Projects
            </h1>
          </div>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Read-only project repositories. Restore anytime to resume testing and defect tracking.
          </p>
        </div>

        <div>
          <Link
            to={currentProject ? '/dashboard' : '/welcome'}
            className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
          >
            <ArrowLeft size={14} />
            <span>{currentProject ? 'Return to Dashboard' : 'Return to Welcome'}</span>
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="mb-md rounded border border-rose-500/30 bg-rose-500/10 p-sm text-body-md text-rose-800 dark:text-rose-300">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="mb-md rounded border border-emerald-500/30 bg-emerald-500/10 p-sm text-body-md text-emerald-800 dark:text-emerald-300">
          {actionSuccess}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-xl text-body-md text-on-surface-variant font-mono">
          <RotateCw className="animate-spin mr-xs" size={16} />
          Loading archived records…
        </div>
      ) : archivedList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center">
          <p className="text-headline-md font-semibold text-on-surface">
            No Archived Projects
          </p>
          <p className="mt-xs max-w-[420px] text-body-md text-on-surface-variant">
            Projects archived from Project Settings will appear here in cold storage.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-sm">
          {archivedList.map((project) => {
            const isOwner = user?.id ? project.owner_id === user.id : false
            const isRestoring = restoringId === project.id
            const isDeleting = deletingId === project.id
            const projectAnchor = `[${project.key}]`

            return (
              <div
                key={project.id}
                className="flex flex-col justify-between gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-md hover:border-outline transition-colors sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-xs">
                    <span className="font-mono text-code-xs font-bold text-on-surface">
                      {projectAnchor}
                    </span>
                    <h2 className="text-body-lg font-bold text-on-surface">
                      {project.name}
                    </h2>
                    {isOwner && (
                      <span className="rounded border border-primary/30 bg-primary-fixed/40 px-xs py-0.2 font-mono text-code-xs font-semibold uppercase text-primary">
                        OWNER
                      </span>
                    )}
                    <span className="rounded border border-outline-variant bg-surface-container-low px-xs py-0.2 font-mono text-code-xs uppercase text-on-surface-variant">
                      ARCHIVED
                    </span>
                  </div>

                  {project.description && (
                    <p className="mt-xs line-clamp-2 text-body-md text-on-surface-variant">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-xs flex flex-wrap items-center gap-sm font-mono text-code-xs text-outline">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {project.archived_at
                        ? `ARCHIVED ${formatDate(project.archived_at)}`
                        : 'ARCHIVED'}
                    </span>
                    <span>·</span>
                    <span>{project.member_count ?? 1} OPERATOR(S)</span>
                  </div>
                </div>

                <div className="flex items-center gap-xs pt-xs border-t border-outline-variant sm:border-0 sm:pt-0">
                  <button
                    type="button"
                    disabled={isRestoring || isDeleting}
                    onClick={() => handleRestore(project)}
                    className="inline-flex items-center gap-xs rounded bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                  >
                    <ArchiveRestore size={14} />
                    <span>{isRestoring ? 'Restoring…' : 'Restore Project'}</span>
                  </button>

                  {isOwner && (
                    <button
                      type="button"
                      disabled={isRestoring || isDeleting}
                      onClick={() => handleDelete(project)}
                      className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-error hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      <span>{isDeleting ? 'Deleting…' : 'Delete'}</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )

  return (
    <>
      {currentProject ? (
        <div className="flex min-h-screen bg-surface">
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <TopBar />
            {renderContent()}
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen flex-col bg-surface">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-md">
            <div className="flex items-center gap-xs">
              <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed tracking-wider">
                [QA-ARCHIVE]
              </span>
              <span className="text-headline-md font-bold tracking-tight text-on-surface">TrackQA</span>
            </div>

            <div className="flex items-center gap-sm">
              <Link
                to="/welcome"
                className="text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
              >
                Welcome
              </Link>
              <Link
                to="/account-settings"
                className="text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
              >
                Account
              </Link>
              <div className="h-4 w-px bg-outline-variant" />
              <div className="flex items-center gap-xs">
                <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={28} />
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-xs rounded border border-outline-variant px-xs py-1 text-label-md font-semibold text-on-surface hover:bg-surface-container"
                >
                  <LogOut size={12} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </header>

          {renderContent()}
        </div>
      )}

      <ConfirmModal
        open={confirmModal.open}
        onClose={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmLabel={confirmModal.confirmLabel}
        variant={confirmModal.variant}
        icon={confirmModal.icon}
        isLoading={confirmModal.isLoading}
      />
    </>
  )
}

export default ArchivedProjects

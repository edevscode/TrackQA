import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bug,
  Calendar,
  ChevronRight,
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

        setActionSuccess(`Project "${project.name}" was permanently deleted.`)
        await refreshProjects()
        loadArchivedProjects()
      },
    })
  }

  const handleSignOut = () => {
    setConfirmModal({
      open: true,
      title: 'Sign Out',
      description: 'Are you sure you want to sign out of your TrackQA account?',
      confirmLabel: 'Sign Out',
      variant: 'primary',
      icon: <LogOut size={22} className="text-primary" />,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        await signOut()
        navigate('/login')
      },
    })
  }

  const renderContent = () => (
    <div className="mx-auto w-full max-w-[1100px] flex-1 px-lg py-lg">
      <div className="flex flex-col gap-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-xs text-body-md text-on-surface-variant">
            {currentProject ? (
              <Link to="/project-settings" className="hover:text-primary transition-colors">
                Project Settings
              </Link>
            ) : (
              <Link to="/welcome" className="hover:text-primary transition-colors">
                Welcome
              </Link>
            )}
            <ChevronRight size={14} />
            <span className="text-on-surface font-medium">Archived Projects</span>
          </div>
          <h1 className="mt-xs text-headline-xl font-bold text-on-surface">
            Archived Projects
          </h1>
          <p className="mt-xs text-body-lg text-on-surface-variant">
            Projects that have been archived. You can restore them anytime to resume work.
          </p>
        </div>

        <div className="mt-md flex items-center gap-sm sm:mt-0">
          <Link
            to={currentProject ? '/dashboard' : '/welcome'}
            className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
          >
            <ArrowLeft size={16} />
            {currentProject ? 'Back to Dashboard' : 'Back to Welcome'}
          </Link>
        </div>
      </div>

      <div className="mt-lg mb-lg border-t border-outline-variant" />

      {actionError && (
        <div className="mb-md rounded-md bg-error-container p-md text-body-md text-on-error-container">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="mb-md rounded-md bg-emerald-50 p-md text-body-md text-emerald-800">
          {actionSuccess}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-xl text-body-lg text-on-surface-variant">
          <RotateCw className="animate-spin mr-sm" size={20} />
          Loading archived projects…
        </div>
      ) : archivedList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest px-lg py-xl text-center">
          <div className="mb-md flex h-12 w-12 items-center justify-center rounded-full bg-surface-container">
            <Archive className="text-on-surface-variant" size={22} />
          </div>
          <h2 className="text-headline-md font-semibold text-on-surface">
            No Archived Projects
          </h2>
          <p className="mt-xs max-w-[420px] text-body-md text-on-surface-variant">
            You do not have any archived projects. Projects archived from settings will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          {archivedList.map((project) => {
            const isOwner = user?.id ? project.owner_id === user.id : false
            const isRestoring = restoringId === project.id
            const isDeleting = deletingId === project.id

            return (
              <div
                key={project.id}
                className="flex flex-col justify-between gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-xs transition-all sm:flex-row sm:items-center"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-sm">
                    <span className="font-mono text-code-sm font-bold text-on-surface-variant">
                      {project.key}
                    </span>
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      {project.name}
                    </h2>
                    {isOwner && (
                      <span className="rounded bg-primary-fixed px-xs py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-primary-fixed">
                        My Project
                      </span>
                    )}
                    <span className="rounded bg-surface-container px-sm py-[2px] text-label-md font-semibold text-on-surface-variant">
                      Archived
                    </span>
                  </div>

                  {project.description && (
                    <p className="mt-xs line-clamp-2 text-body-md text-on-surface-variant">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-sm flex flex-wrap items-center gap-md text-body-md text-on-surface-variant">
                    <span className="flex items-center gap-xs">
                      <Calendar size={14} />
                      {project.archived_at
                        ? `Archived on ${formatDate(project.archived_at)}`
                        : 'Archived'}
                    </span>
                    <span>•</span>
                    <span>{project.member_count ?? 1} team member(s)</span>
                  </div>
                </div>

                <div className="flex items-center gap-sm pt-sm border-t border-outline-variant/60 sm:border-0 sm:pt-0">
                  <button
                    type="button"
                    disabled={isRestoring || isDeleting}
                    onClick={() => handleRestore(project)}
                    className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60 transition-colors"
                  >
                    <ArchiveRestore size={16} />
                    {isRestoring ? 'Restoring…' : 'Restore Project'}
                  </button>

                  {isOwner && (
                    <button
                      type="button"
                      disabled={isRestoring || isDeleting}
                      onClick={() => handleDelete(project)}
                      className="flex items-center gap-xs rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-60 transition-colors"
                    >
                      <Trash2 size={16} />
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <>
      {currentProject ? (
        <div className="flex min-h-screen bg-surface">
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <TopBar />
            {renderContent()}
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen flex-col bg-surface">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-lg">
            <div className="flex items-center gap-sm">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
                <Bug className="text-on-primary" size={18} />
              </div>
              <span className="text-headline-md font-bold text-primary">TrackQA</span>
            </div>

            <div className="flex items-center gap-md">
              <Link
                to="/welcome"
                className="text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
              >
                Welcome Hub
              </Link>
              <Link
                to="/account-settings"
                className="text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
              >
                Account Settings
              </Link>
              <div className="h-6 w-px bg-outline-variant" />
              <div className="flex items-center gap-sm">
                <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={36} />
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex items-center gap-xs rounded-md border border-outline-variant px-sm py-xs text-body-md font-medium text-on-surface hover:bg-surface-container-low"
                >
                  <LogOut size={14} />
                  Sign Out
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

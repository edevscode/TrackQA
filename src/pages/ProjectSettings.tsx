import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  RotateCw,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchProjectSettingsData,
  invalidateProjectCache,
  invalidateProjectSettingsCache,
  prefetchAccountSettingsData,
  type ProjectSettingsMember,
} from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { ProjectRole } from '../lib/database.types'

const tabs = ['General', 'Member Roles', 'Danger Zone']

type MemberRow = ProjectSettingsMember

const roleBadgeConfig: Record<ProjectRole, { label: string; className: string }> = {
  OWNER: {
    label: 'OWNER',
    className: 'border-primary/30 bg-primary-fixed/30 text-primary',
  },
  DEVELOPER: {
    label: 'DEV',
    className: 'border-outline-variant bg-surface-container-low text-on-surface',
  },
  QA: {
    label: 'QA LAB',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
}

function ProjectSettings() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentProject, projects, refreshProjects, setCurrentProjectId } = useProject()

  const [tab, setTab] = useState('General')
  const generalRef = useRef<HTMLFormElement>(null)
  const memberRolesRef = useRef<HTMLDivElement>(null)
  const dangerZoneRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Record<string, RefObject<HTMLElement | null>> = {
    General: generalRef,
    'Member Roles': memberRolesRef,
    'Danger Zone': dangerZoneRef,
  }

  const goToTab = (t: string) => {
    setTab(t)
    sectionRefs[t]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [isEditingGeneral, setIsEditingGeneral] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const [copiedCode, setCopiedCode] = useState(false)
  const [regeneratingCode, setRegeneratingCode] = useState(false)
  const [accessCodeSuccess, setAccessCodeSuccess] = useState<string | null>(null)
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [dangerError, setDangerError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  useEffect(() => {
    if (!currentProject) return
    setName(currentProject.name)
    setDescription(currentProject.description ?? '')
  }, [currentProject])

  const loadMembers = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject) return
      const rows = await fetchProjectSettingsData(currentProject.id, { forceRefresh })
      setMembers(rows)

      if (user?.id) {
        prefetchAccountSettingsData(user.id)
      }
    },
    [currentProject, user],
  )

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => loadMembers(true),
  })

  const isOwner = Boolean(user?.id && currentProject?.owner_id === user.id)

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!currentProject || !isOwner) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const { error } = await supabase
      .from('projects')
      .update({ name, description: description || null })
      .eq('id', currentProject.id)

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    invalidateProjectCache(currentProject.id)
    setSaveSuccess(true)
    setIsEditingGeneral(false)
    await refreshProjects()
  }

  const handleRoleChange = async (userId: string, role: ProjectRole) => {
    if (!currentProject || !isOwner) return
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)))
    invalidateProjectSettingsCache(currentProject.id)
    await supabase
      .from('project_members')
      .update({ role })
      .eq('project_id', currentProject.id)
      .eq('user_id', userId)
  }

  const handleRemoveMember = (userId: string, memberName: string) => {
    if (!currentProject || !isOwner) return
    setConfirmModal({
      open: true,
      title: 'Remove Team Member',
      description: `Are you sure you want to remove ${memberName} from this project? They will immediately lose access.`,
      confirmLabel: 'Remove Member',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        const { error } = await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentProject.id)
          .eq('user_id', userId)

        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setDangerError(error.message)
          return
        }
        invalidateProjectSettingsCache(currentProject.id)
        setMembers((prev) => prev.filter((m) => m.user_id !== userId))
      },
    })
  }

  const handleCopyCode = async () => {
    if (!currentProject?.access_code) return
    await navigator.clipboard.writeText(currentProject.access_code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleRegenerateCode = async () => {
    if (!currentProject || !isOwner) return
    setRegeneratingCode(true)
    setAccessCodeError(null)
    setAccessCodeSuccess(null)

    const { data: newCode, error } = await supabase.rpc('regenerate_project_access_code', {
      p_project_id: currentProject.id,
    })

    setRegeneratingCode(false)
    if (error || !newCode) {
      setAccessCodeError(error?.message ?? 'Failed to regenerate code')
      return
    }

    setAccessCodeSuccess('New project access code generated successfully.')
    invalidateProjectCache(currentProject.id)
    await refreshProjects()
    setTimeout(() => setAccessCodeSuccess(null), 3000)
  }

  const handleArchive = () => {
    if (!currentProject) return
    setConfirmModal({
      open: true,
      title: 'Archive Project',
      description: `Are you sure you want to archive "${currentProject.name}"? It will be hidden from active navigation and set to read-only mode. You can restore it anytime.`,
      confirmLabel: 'Archive Project',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setArchiving(true)
        setDangerError(null)
        const { error } = await supabase
          .from('projects')
          .update({ archived: true, archived_at: new Date().toISOString() })
          .eq('id', currentProject.id)
        setArchiving(false)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setDangerError(error.message)
          return
        }
        invalidateProjectCache(currentProject.id)
        await refreshProjects()
        const remaining = projects.filter((p) => p.id !== currentProject.id)
        if (remaining.length > 0) {
          setCurrentProjectId(remaining[0].id)
          navigate('/dashboard')
        } else {
          navigate('/welcome')
        }
      },
    })
  }

  const handleDelete = () => {
    if (!currentProject) return
    setConfirmModal({
      open: true,
      title: 'Delete Project Permanently',
      description: `Are you sure you want to permanently delete "${currentProject.name}"? All associated issues, comments, attachments, and QA logs will be destroyed forever.`,
      confirmLabel: 'Delete Forever',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setDeleting(true)
        setDangerError(null)
        const { error } = await supabase
          .from('projects')
          .delete()
          .eq('id', currentProject.id)
        setDeleting(false)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setDangerError(error.message)
          return
        }
        invalidateProjectCache(currentProject.id)
        await refreshProjects()
        const remaining = projects.filter((p) => p.id !== currentProject.id)
        if (remaining.length > 0) {
          setCurrentProjectId(remaining[0].id)
          navigate('/dashboard')
        } else {
          navigate('/welcome')
        }
      },
    })
  }

  if (!currentProject) return null

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header */}
          <div className="mb-md">
            <div className="flex items-center gap-xs">
              <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                [{currentProject.key}]
              </span>
              <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                Project Configuration
              </h1>
            </div>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Manage project metadata, access codes, permissions, and lifecycle states.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-md lg:grid-cols-[220px_1fr]">
            {/* Navigation Tabs */}
            <div className="h-fit rounded-lg border border-outline-variant bg-surface-container-lowest p-xs space-y-xs">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => goToTab(t)}
                  className={`flex w-full items-center justify-between rounded px-sm py-xs text-left text-body-md font-semibold transition-colors ${
                    tab === t
                      ? 'bg-primary-fixed/40 text-primary'
                      : t === 'Danger Zone'
                        ? 'text-error hover:bg-rose-500/10'
                        : 'text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span>{t}</span>
                  {tab === t && <ChevronRight size={14} />}
                </button>
              ))}
            </div>

            {/* Content Pane */}
            <div className="flex flex-col gap-md">
              {!isOwner && (
                <div className="rounded-lg border border-outline-variant bg-surface-container-low p-sm text-body-md text-on-surface-variant">
                  You are viewing project settings in read-only mode. Only the project owner can update project parameters.
                </div>
              )}

              {/* General Information Section */}
              <form
                ref={generalRef}
                onSubmit={handleSave}
                className="scroll-mt-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
              >
                <div className="flex items-center justify-between border-b border-outline-variant pb-xs mb-sm">
                  <div>
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      General Specifications
                    </h2>
                    <p className="font-mono text-code-xs text-on-surface-variant">
                      Identity tokens and project-wide ticket prefixes.
                    </p>
                  </div>
                  {isOwner && !isEditingGeneral && (
                    <button
                      type="button"
                      onClick={() => setIsEditingGeneral(true)}
                      className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                    >
                      <Pencil size={13} />
                      <span>Edit</span>
                    </button>
                  )}
                </div>

                <div className="space-y-sm">
                  {saveError && (
                    <p className="rounded border border-rose-500/30 bg-rose-500/10 p-xs text-body-md text-rose-800 dark:text-rose-300">
                      {saveError}
                    </p>
                  )}
                  {saveSuccess && (
                    <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-xs text-body-md text-emerald-800 dark:text-emerald-300">
                      Project settings saved successfully.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="projectName"
                        className="mb-xs block text-label-md font-bold text-on-surface"
                      >
                        Project Name <span className="text-error">*</span>
                      </label>
                      <input
                        id="projectName"
                        type="text"
                        disabled={!isOwner || !isEditingGeneral}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest disabled:opacity-60"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="projectKey"
                        className="mb-xs block text-label-md font-bold text-on-surface"
                      >
                        Issue Prefix Key (Immutable)
                      </label>
                      <input
                        id="projectKey"
                        type="text"
                        disabled
                        value={currentProject.key}
                        className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs font-mono text-code-sm font-bold text-on-surface-variant outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="description"
                      className="mb-xs block text-label-md font-bold text-on-surface"
                    >
                      Project Description
                    </label>
                    <textarea
                      id="description"
                      rows={3}
                      disabled={!isOwner || !isEditingGeneral}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief overview of this project scope..."
                      className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest disabled:opacity-60"
                    />
                  </div>

                  {/* Access Code Workbench Box */}
                  {isOwner && (
                    <div className="pt-xs border-t border-outline-variant">
                      <label className="mb-xs block text-label-md font-bold text-on-surface">
                        Self-Enrollment Access Code
                      </label>
                      <div className="flex flex-wrap items-center gap-xs">
                        <div className="flex items-center rounded border border-outline-variant bg-surface-container-low pl-sm pr-xs py-1">
                          <span className="font-mono text-code-sm font-bold tracking-wider text-primary mr-sm">
                            {currentProject.access_code ?? 'NONE'}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            title={copiedCode ? 'Copied' : 'Copy access code'}
                            aria-label={copiedCode ? 'Copied' : 'Copy access code'}
                            className="flex h-6 w-6 items-center justify-center rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
                          >
                            {copiedCode ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={regeneratingCode}
                          onClick={handleRegenerateCode}
                          className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-mono text-code-xs font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
                        >
                          <RotateCw size={12} className={regeneratingCode ? 'animate-spin' : ''} />
                          <span>{regeneratingCode ? 'REGENERATING…' : 'ROTATE CODE'}</span>
                        </button>
                      </div>

                      {accessCodeSuccess && (
                        <p className="mt-xs text-body-md text-emerald-600">{accessCodeSuccess}</p>
                      )}
                      {accessCodeError && (
                        <p className="mt-xs text-body-md text-error">{accessCodeError}</p>
                      )}
                    </div>
                  )}

                  {isOwner && isEditingGeneral && (
                    <div className="flex justify-end gap-xs pt-xs border-t border-outline-variant">
                      <button
                        type="button"
                        onClick={() => {
                          setName(currentProject.name)
                          setDescription(currentProject.description ?? '')
                          setSaveError(null)
                          setSaveSuccess(false)
                          setIsEditingGeneral(false)
                        }}
                        className="rounded border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </div>
              </form>

              {/* Member Roles & Access */}
              <div
                ref={memberRolesRef}
                className="scroll-mt-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
              >
                <div className="flex items-center justify-between border-b border-outline-variant pb-xs mb-sm">
                  <div>
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Personnel Access Matrix
                    </h2>
                    <p className="font-mono text-code-xs text-on-surface-variant">
                      Project roles, triage access, and QA execution rights.
                    </p>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => navigate('/members')}
                      className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                    >
                      <UserPlus size={13} />
                      <span>Manage Members</span>
                    </button>
                  )}
                </div>

                <div className="divide-y divide-outline-variant">
                  {members.map((member) => {
                    const roleInfo = roleBadgeConfig[member.role]
                    return (
                      <div
                        key={member.user_id}
                        className="flex items-center justify-between gap-sm py-xs hover:bg-surface-container-low/50 transition-colors"
                      >
                        <div className="flex items-center gap-xs min-w-0">
                          <Avatar name={member.full_name} avatarUrl={member.avatar_url} size={28} />
                          <div className="min-w-0">
                            <p className="truncate text-body-md font-semibold text-on-surface">
                              {member.full_name ?? 'Unnamed'}
                            </p>
                            <p className="truncate font-mono text-code-xs text-outline">
                              {member.email}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-xs">
                          {isOwner && member.user_id !== user?.id ? (
                            <div className="relative inline-block">
                              <select
                                value={member.role}
                                onChange={(e) =>
                                  handleRoleChange(member.user_id, e.target.value as ProjectRole)
                                }
                                className={`appearance-none rounded border px-xs py-0.5 font-mono text-code-xs font-semibold uppercase outline-none pr-5 ${roleInfo.className}`}
                              >
                                <option value="DEVELOPER">DEV</option>
                                <option value="QA">QA LAB</option>
                                <option value="OWNER">OWNER</option>
                              </select>
                              <ChevronDown
                                size={11}
                                className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-70"
                              />
                            </div>
                          ) : (
                            <span
                              className={`inline-block rounded border px-xs py-0.5 font-mono text-code-xs font-semibold uppercase ${roleInfo.className}`}
                            >
                              {roleInfo.label}
                            </span>
                          )}

                          {isOwner && member.user_id !== user?.id && (
                            <button
                              type="button"
                              title={`Remove ${member.full_name ?? member.email}`}
                              aria-label={`Remove ${member.full_name ?? member.email}`}
                              onClick={() =>
                                handleRemoveMember(
                                  member.user_id,
                                  member.full_name ?? member.email,
                                )
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-outline hover:bg-rose-500/10 hover:text-error transition-colors"
                            >
                              <UserMinus size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Danger Zone */}
              <div
                ref={dangerZoneRef}
                className="scroll-mt-md rounded-lg border border-rose-500/30 bg-surface-container-lowest p-md"
              >
                <div className="flex items-center gap-xs border-b border-rose-500/20 pb-xs mb-sm">
                  <AlertTriangle className="text-rose-600" size={16} />
                  <h2 className="font-mono text-code-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                    Danger Zone · Destructive Operations
                  </h2>
                </div>

                {dangerError && (
                  <p className="mb-sm rounded border border-rose-500/30 bg-rose-500/10 p-xs text-body-md text-rose-800 dark:text-rose-300">
                    {dangerError}
                  </p>
                )}

                <div className="space-y-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-xs">
                    <div>
                      <p className="text-body-md font-bold text-on-surface">
                        Archive Project
                      </p>
                      <p className="text-body-md text-on-surface-variant">
                        Sets this project to read-only status and removes it from active backlogs. Viewable anytime in{' '}
                        <Link to="/projects/archived" className="font-semibold text-primary hover:underline">
                          Archived Projects
                        </Link>
                        .
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!isOwner || archiving}
                      onClick={handleArchive}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container-lowest px-md py-xs font-mono text-code-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-surface-container transition-colors disabled:opacity-50"
                    >
                      {archiving ? 'ARCHIVING…' : 'ARCHIVE PROJECT'}
                    </button>
                  </div>

                  <div className="pt-sm border-t border-rose-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-xs">
                    <div>
                      <p className="text-body-md font-bold text-error">
                        Delete Project Permanently
                      </p>
                      <p className="text-body-md text-on-surface-variant">
                        Destroys all tickets, reproduction steps, verification evidence, and activity ledger permanently.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!isOwner || deleting}
                      onClick={handleDelete}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-rose-500/40 bg-rose-500/10 px-md py-xs font-mono text-code-xs font-bold text-error hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                    >
                      {deleting ? 'DELETING…' : 'DELETE FOREVER'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

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
    </div>
  )
}

export default ProjectSettings

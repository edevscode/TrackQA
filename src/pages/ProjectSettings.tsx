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

      // Prefetch Account Settings while on Project Settings page
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
      title: 'Remove Member',
      description: `Are you sure you want to remove ${memberName} from this project? They will immediately lose access to all issues and project data.`,
      confirmLabel: 'Remove Member',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setMembers((prev) => prev.filter((m) => m.user_id !== userId))
        invalidateProjectSettingsCache(currentProject.id)
        await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentProject.id)
          .eq('user_id', userId)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
      },
    })
  }

  const handleCopyCode = async () => {
    if (!currentProject?.access_code) return
    await navigator.clipboard.writeText(currentProject.access_code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const handleRegenerateCode = () => {
    if (!currentProject || !isOwner) return
    setConfirmModal({
      open: true,
      title: 'Regenerate Access Code',
      description:
        'Are you sure you want to regenerate the project access code? The previous code will immediately stop working and cannot be restored.',
      confirmLabel: 'Regenerate Code',
      variant: 'warning',
      icon: <RotateCw size={22} className="text-amber-600" />,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setRegeneratingCode(true)
        setAccessCodeError(null)
        setAccessCodeSuccess(null)

        const { error } = await supabase.rpc('regenerate_project_access_code', {
          p_project_id: currentProject.id,
        })

        setRegeneratingCode(false)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setAccessCodeError(error.message)
          return
        }

        invalidateProjectSettingsCache(currentProject.id)
        setAccessCodeSuccess('Project access code regenerated successfully.')
        await refreshProjects()
      },
    })
  }

  const handleArchive = () => {
    if (!currentProject) return
    setConfirmModal({
      open: true,
      title: 'Archive Project',
      description: `Are you sure you want to archive "${currentProject.name}"? It will be hidden from your active projects list, but can be restored anytime from the Archived Projects Hub.`,
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
          navigate('/projects/archived')
        }
      },
    })
  }

  const handleDelete = () => {
    if (!currentProject) return
    setConfirmModal({
      open: true,
      title: 'Delete Project Permanently',
      description: `Are you sure you want to permanently delete "${currentProject.name}"? All associated issues, comments, attachments, and history will be destroyed forever. This action cannot be undone.`,
      confirmLabel: 'Delete Project',
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

      <div className="mx-auto w-full max-w-[1280px] flex-1 px-lg py-lg">
        <h1 className="text-headline-xl font-bold text-on-surface">
          Project Settings
        </h1>
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Manage your project configuration, team members, and lifecycle.
        </p>

        <div className="mt-lg grid grid-cols-1 gap-lg lg:grid-cols-[220px_1fr]">
          <div className="h-fit rounded-lg border border-outline-variant bg-surface-container-lowest p-sm">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => goToTab(t)}
                className={`flex w-full items-center justify-between rounded-md px-md py-sm text-left text-body-md font-medium transition-colors ${
                  tab === t
                    ? 'bg-primary-fixed text-primary'
                    : t === 'Danger Zone'
                      ? 'text-rose-600 hover:bg-surface-container-low'
                      : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                {t}
                {tab === t && <ChevronRight size={16} />}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-lg">
            {!isOwner && (
              <p className="rounded-md bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">
                Only the project owner can change these settings. You can
                still view them below.
              </p>
            )}

            <form
              ref={generalRef}
              onSubmit={handleSave}
              className="scroll-mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest"
            >
              <div className="flex items-center justify-between px-lg py-md">
                <h2 className="text-headline-md font-semibold text-on-surface">
                  General Information
                </h2>
                {isOwner && !isEditingGeneral && (
                  <button
                    type="button"
                    onClick={() => setIsEditingGeneral(true)}
                    className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                  >
                    <Pencil size={16} />
                    Edit
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-md border-t border-outline-variant px-lg py-lg">
                {saveError && (
                  <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                    {saveError}
                  </p>
                )}
                {saveSuccess && (
                  <p className="rounded-md bg-emerald-50 px-md py-sm text-body-md text-emerald-800">
                    Saved.
                  </p>
                )}
                <div>
                  <label
                    htmlFor="projectName"
                    className="mb-sm block text-body-md font-semibold text-on-surface"
                  >
                    Project Name
                  </label>
                  <input
                    id="projectName"
                    type="text"
                    disabled={!isOwner || !isEditingGeneral}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="projectKey"
                    className="mb-sm block text-body-md font-semibold text-on-surface"
                  >
                    Project Key (Prefix)
                  </label>
                  <input
                    id="projectKey"
                    type="text"
                    disabled
                    value={currentProject.key}
                    className="w-[160px] rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-lg text-on-surface-variant outline-none"
                  />
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    This key is used as a prefix for all issues (e.g.,
                    {' '}{currentProject.key}-123). It cannot be changed after
                    creation.
                  </p>
                </div>

                {isOwner && (
                  <div>
                    <label
                      htmlFor="accessCode"
                      className="mb-sm block text-body-md font-semibold text-on-surface"
                    >
                      Project Access Code
                    </label>
                    <div className="flex flex-wrap items-center gap-sm">
                      <div className="flex items-center rounded-md border border-outline-variant bg-surface-container-low pl-md pr-xs py-[6px]">
                        <span className="font-mono text-body-lg font-bold tracking-wider text-primary mr-sm">
                          {currentProject.access_code ?? 'None'}
                        </span>
                        <div className="relative group">
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            aria-label={copiedCode ? 'Copied' : 'Copy access code'}
                            className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
                          >
                            {copiedCode ? (
                              <Check size={16} className="text-emerald-600" />
                            ) : (
                              <Copy size={16} />
                            )}
                          </button>
                          <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-inverse-surface px-xs py-[2px] text-label-md text-inverse-on-surface opacity-0 shadow-xs transition-opacity group-hover:opacity-100 z-10">
                            {copiedCode ? 'Copied!' : 'Copy code'}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={regeneratingCode}
                        onClick={handleRegenerateCode}
                        className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60 transition-colors"
                      >
                        <RotateCw
                          size={14}
                          className={regeneratingCode ? 'animate-spin' : ''}
                        />
                        {regeneratingCode ? 'Regenerating…' : 'Regenerate Code'}
                      </button>
                    </div>
                    {accessCodeSuccess && (
                      <p className="mt-xs text-body-md text-emerald-700">
                        {accessCodeSuccess}
                      </p>
                    )}
                    {accessCodeError && (
                      <p className="mt-xs text-body-md text-error">
                        {accessCodeError}
                      </p>
                    )}
                    <p className="mt-xs text-body-md text-on-surface-variant">
                      Teammates can use this code to join this project directly on the Join Workspace page without an email invitation.
                    </p>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="description"
                    className="mb-sm block text-body-md font-semibold text-on-surface"
                  >
                    Description
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    disabled={!isOwner || !isEditingGeneral}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                  />
                </div>
              </div>
              {isOwner && isEditingGeneral && (
                <div className="flex justify-end gap-md rounded-b-lg border-t border-outline-variant bg-surface-container-low px-lg py-md">
                  <button
                    type="button"
                    onClick={() => {
                      setName(currentProject.name)
                      setDescription(currentProject.description ?? '')
                      setSaveError(null)
                      setSaveSuccess(false)
                      setIsEditingGeneral(false)
                    }}
                    className="rounded-md px-md py-sm text-body-md font-semibold text-on-surface-variant hover:bg-surface-container"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              )}
            </form>

            <div ref={memberRolesRef} className="scroll-mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center justify-between px-lg py-md">
                <h2 className="text-headline-md font-semibold text-on-surface">
                  Member Roles &amp; Access
                </h2>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => navigate('/members')}
                    className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                  >
                    <UserPlus size={16} />
                    Invite Member
                  </button>
                )}
              </div>

              <table className="w-full">
                <thead>
                  <tr className="border-t border-outline-variant bg-surface-container-low text-left text-label-md uppercase tracking-wide text-on-surface-variant">
                    <th className="px-lg py-sm font-semibold">User</th>
                    <th className="px-lg py-sm font-semibold">Role</th>
                    <th className="px-lg py-sm text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr
                      key={member.user_id}
                      className="border-t border-outline-variant hover:bg-surface-container-low"
                    >
                      <td className="px-lg py-md">
                        <div className="flex items-center gap-sm">
                          <Avatar name={member.full_name} avatarUrl={member.avatar_url} size={36} />
                          <div>
                            <p className="text-body-lg font-semibold text-on-surface">
                              {member.full_name ?? 'Unnamed'}
                            </p>
                            <p className="text-body-md text-on-surface-variant">
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-lg py-md">
                        <div className="relative inline-flex">
                          <select
                            disabled={!isOwner}
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(member.user_id, e.target.value as ProjectRole)
                            }
                            className="appearance-none rounded-md px-sm py-xs pr-lg text-body-md text-on-surface outline-none hover:bg-surface-container disabled:opacity-60"
                          >
                            <option value="OWNER">Project Lead</option>
                            <option value="DEVELOPER">Developer</option>
                            <option value="QA">QA</option>
                          </select>
                          <ChevronDown
                            className="pointer-events-none absolute right-xs top-1/2 -translate-y-1/2 text-on-surface-variant"
                            size={16}
                          />
                        </div>
                      </td>
                      <td className="px-lg py-md text-right">
                        {isOwner && member.user_id !== user?.id && (
                          <button
                            type="button"
                            aria-label={`Remove ${member.full_name ?? member.email}`}
                            onClick={() =>
                              handleRemoveMember(
                                member.user_id,
                                member.full_name ?? member.email,
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container hover:text-rose-600"
                          >
                            <UserMinus size={18} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div ref={dangerZoneRef} className="scroll-mt-lg rounded-lg border border-rose-200 bg-surface-container-lowest">
              <div className="flex items-center gap-sm border-b border-rose-200 px-lg py-md">
                <AlertTriangle className="text-rose-600" size={20} />
                <h2 className="text-headline-md font-semibold text-rose-600">
                  Danger Zone
                </h2>
              </div>

              {dangerError && (
                <p className="mx-lg mt-lg rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                  {dangerError}
                </p>
              )}

              <div className="flex items-center justify-between gap-md px-lg py-lg">
                <div>
                  <p className="text-body-lg font-semibold text-on-surface">
                    Archive Project
                  </p>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Archiving a project makes it read-only. It will be hidden
                    from the active project list, but you can view and restore
                    it anytime in the{' '}
                    <Link
                      to="/projects/archived"
                      className="font-semibold text-primary hover:underline"
                    >
                      Archived Projects Hub
                    </Link>
                    .
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOwner || archiving}
                  onClick={handleArchive}
                  className="shrink-0 text-body-md font-semibold text-rose-600 hover:underline disabled:opacity-50"
                >
                  {archiving ? 'Archiving…' : 'Archive Project'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-md border-t border-rose-100 px-lg py-lg">
                <div>
                  <p className="text-body-lg font-semibold text-on-surface">
                    Delete Project
                  </p>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Once you delete a project, there is no going back.
                    Please be certain. All issues, attachments, and history
                    will be permanently destroyed.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOwner || deleting}
                  onClick={handleDelete}
                  className="shrink-0 text-body-md font-bold text-on-surface hover:underline disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
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

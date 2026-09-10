import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  KeyRound,
  LogOut,
  Search,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchMembersData,
  invalidateMembersCache,
  prefetchNotificationsData,
  queryCache,
  type MemberListItem,
} from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { ProjectInvitation, ProjectRole } from '../lib/database.types'

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

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

type MemberRow = MemberListItem

function Members() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentProject, refreshProjects } = useProject()

  const [members, setMembers] = useState<MemberRow[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<ProjectInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<ProjectRole | ''>('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

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

  const isOwner = members.some((m) => m.user_id === user?.id && m.role === 'OWNER')

  const handleCopyCode = async () => {
    if (!currentProject?.access_code) return
    await navigator.clipboard.writeText(currentProject.access_code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('DEVELOPER')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!currentProject) return

      const cacheKey = `members:${currentProject.id}`
      const hasCached = !forceRefresh && queryCache.get(cacheKey)

      if (!hasCached) {
        setLoading(true)
      }

      try {
        const res = await fetchMembersData(currentProject.id, { forceRefresh })
        setMembers(res.members)
        setPendingInvitations(res.pendingInvitations)
      } finally {
        setLoading(false)
      }

      if (user?.id) {
        prefetchNotificationsData(user.id)
      }
    },
    [currentProject, user],
  )

  useEffect(() => {
    load()
  }, [load])

  useRealtimeSync({
    projectId: currentProject?.id,
    userId: user?.id,
    onRefresh: () => load(true),
  })

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (roleFilter && m.role !== roleFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        return (
          m.full_name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [members, search, roleFilter])

  const handleRoleChange = async (userId: string, role: ProjectRole) => {
    if (!currentProject || !isOwner) return
    setActionError(null)

    const previousRole = members.find((m) => m.user_id === userId)?.role

    // Optimistic UI update
    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role } : m)),
    )

    const { error } = await supabase
      .from('project_members')
      .update({ role })
      .eq('project_id', currentProject.id)
      .eq('user_id', userId)

    if (error) {
      if (previousRole) {
        setMembers((prev) =>
          prev.map((m) => (m.user_id === userId ? { ...m, role: previousRole } : m)),
        )
      }
      setActionError(error.message)
    } else {
      invalidateMembersCache(currentProject.id)
    }
  }

  const handleRemove = (userId: string, name: string) => {
    if (!currentProject || !isOwner) return
    setConfirmModal({
      open: true,
      title: 'Remove Member',
      description: `Are you sure you want to remove ${name} from this project? They will lose access immediately.`,
      confirmLabel: 'Remove Member',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setActionError(null)

        const { error } = await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentProject.id)
          .eq('user_id', userId)

        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setActionError(error.message)
          return
        }
        invalidateMembersCache(currentProject.id)
        setMembers((prev) => prev.filter((m) => m.user_id !== userId))
      },
    })
  }

  const handleLeave = () => {
    if (!currentProject || !user) return
    setConfirmModal({
      open: true,
      title: 'Leave Project',
      description: `Are you sure you want to leave "${currentProject.name}"? You will lose access until you are re-invited.`,
      confirmLabel: 'Leave Project',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setActionError(null)

        const { error } = await supabase
          .from('project_members')
          .delete()
          .eq('project_id', currentProject.id)
          .eq('user_id', user.id)

        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setActionError(error.message)
          return
        }
        invalidateMembersCache(currentProject.id)
        await refreshProjects()
        navigate('/dashboard')
      },
    })
  }

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault()
    if (!currentProject || !isOwner) return
    setInviting(true)
    setInviteError(null)

    const { error } = await supabase.rpc('invite_member', {
      p_project_id: currentProject.id,
      p_email: inviteEmail.trim(),
      p_role: inviteRole,
    })

    setInviting(false)
    if (error) {
      setInviteError(
        error.message.includes('duplicate')
          ? 'This email already has a pending invitation.'
          : error.message,
      )
      return
    }
    setInviteEmail('')
    setInviteOpen(false)
    invalidateMembersCache(currentProject.id)
    load()
  }

  const handleCancelInvite = (invitationId: string, email: string) => {
    if (!currentProject) return
    setConfirmModal({
      open: true,
      title: 'Cancel Invitation',
      description: `Are you sure you want to cancel the pending invitation for ${email}?`,
      confirmLabel: 'Cancel Invitation',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        setCancelingId(invitationId)
        setActionError(null)

        const { error } = await supabase
          .from('project_invitations')
          .delete()
          .eq('id', invitationId)
          .eq('project_id', currentProject.id)

        setCancelingId(null)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setActionError(error.message)
          return
        }
        invalidateMembersCache(currentProject.id)
        setPendingInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
      },
    })
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header Bar */}
          <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-xs">
                <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                  [{currentProject?.key ?? 'QA'}]
                </span>
                <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                  Team Personnel
                </h1>
              </div>
              <p className="mt-xs text-body-md text-on-surface-variant">
                Manage project operators, development assignees, and QA lab permissions.
              </p>
            </div>

            {isOwner && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="inline-flex shrink-0 items-center gap-xs rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
              >
                <UserPlus size={16} />
                <span>Invite Member</span>
              </button>
            )}
          </div>

          {!isOwner && (
            <div className="mb-md rounded-lg border border-outline-variant bg-surface-container-low p-sm text-body-md text-on-surface-variant">
              You are viewing this project as an operator. Only the project owner can invite or modify member roles.
            </div>
          )}

          {/* Project Access Code Workbench Card */}
          {isOwner && currentProject?.access_code && (
            <div className="mb-md flex flex-wrap items-center justify-between gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
              <div className="flex items-center gap-sm">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-primary/30 bg-primary-fixed/30 text-primary">
                  <KeyRound size={16} />
                </div>
                <div>
                  <p className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Project Access Code
                  </p>
                  <p className="font-mono text-code-xs text-on-surface-variant">
                    Operators can enter this code on the Join Project bench to enroll directly.
                  </p>
                </div>
              </div>

              <div className="flex items-center rounded border border-outline-variant bg-surface-container-low pl-md pr-xs py-1">
                <span className="font-mono text-code-sm font-bold tracking-wider text-primary mr-sm">
                  {currentProject.access_code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title={copiedCode ? 'Copied' : 'Copy access code'}
                  aria-label={copiedCode ? 'Copied' : 'Copy access code'}
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
                >
                  {copiedCode ? (
                    <Check size={14} className="text-emerald-600" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="mb-md rounded-md border border-rose-500/30 bg-rose-500/10 p-sm text-body-md text-rose-800 dark:text-rose-300">
              {actionError}
            </div>
          )}

          {/* Filter Bar */}
          <div className="mb-md flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-sm">
            <div className="flex min-w-[240px] flex-1 items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md focus-within:border-primary transition-colors">
              <Search size={16} className="text-outline shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search member name or email…"
                className="w-full bg-transparent text-on-surface outline-none placeholder:text-outline"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-outline hover:text-on-surface"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="relative">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as ProjectRole | '')}
                className="appearance-none rounded border border-outline-variant bg-surface-container-low py-xs pl-sm pr-lg text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors outline-none"
              >
                <option value="">All Roles</option>
                <option value="OWNER">Owner</option>
                <option value="DEVELOPER">Developer</option>
                <option value="QA">QA Lab</option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-xs top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={13}
              />
            </div>
          </div>

          {/* Members Table */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
            {loading ? (
              <div className="p-xl text-center text-body-md text-on-surface-variant font-mono">
                Loading personnel roster…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center p-xl text-center">
                <p className="text-headline-md font-semibold text-on-surface">No members found</p>
                <p className="mt-xs text-body-md text-on-surface-variant">
                  No teammates match the specified search or filter criteria.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table Header */}
                <div className="hidden border-b border-outline-variant bg-surface-container-low px-md py-xs font-mono text-code-xs font-bold uppercase tracking-wider text-on-surface-variant lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(140px,0.8fr)_minmax(90px,0.6fr)_60px] lg:items-center lg:gap-sm">
                  <span>Operator</span>
                  <span>Email Address</span>
                  <span>Assigned Role</span>
                  <span>Active Queue</span>
                  <span className="text-right">Action</span>
                </div>

                <div className="divide-y divide-outline-variant">
                  {filtered.map((member) => {
                    const roleInfo = roleBadgeConfig[member.role]
                    const leaveButton = member.user_id === user?.id && member.role !== 'OWNER' && (
                      <button
                        type="button"
                        aria-label="Leave project"
                        onClick={handleLeave}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-outline hover:bg-rose-500/10 hover:text-error transition-colors"
                        title="Leave project"
                      >
                        <LogOut size={16} />
                      </button>
                    )
                    const removeButton = member.user_id !== user?.id && isOwner && (
                      <button
                        type="button"
                        aria-label={`Remove ${member.full_name ?? member.email}`}
                        onClick={() => handleRemove(member.user_id, member.full_name ?? member.email)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-outline hover:bg-rose-500/10 hover:text-error transition-colors"
                        title="Remove member"
                      >
                        <UserMinus size={16} />
                      </button>
                    )

                    return (
                      <div
                        key={member.user_id}
                        className="p-sm hover:bg-surface-container-low/50 transition-colors lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(140px,0.8fr)_minmax(90px,0.6fr)_60px] lg:items-center lg:gap-sm lg:px-md"
                      >
                        <div className="flex min-w-0 items-center gap-xs">
                          <Avatar
                            name={member.full_name}
                            avatarUrl={member.avatar_url}
                            size={28}
                            className="shrink-0"
                          />
                          <span className="min-w-0 truncate text-body-md font-semibold text-on-surface">
                            {member.full_name ?? 'Unnamed'}
                            {member.user_id === user?.id && (
                              <span className="ml-xs font-mono text-code-xs text-outline">
                                (You)
                              </span>
                            )}
                          </span>
                        </div>

                        <span className="min-w-0 truncate font-mono text-code-xs text-on-surface-variant">
                          {member.email}
                        </span>

                        <div>
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
                        </div>

                        <span className="font-mono text-code-xs text-on-surface">
                          {member.assigned_issues} tickets
                        </span>

                        <div className="text-right">{leaveButton || removeButton}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Pending Invitations Ledger */}
          {isOwner && pendingInvitations.length > 0 && (
            <div className="mt-md rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
              <div className="border-b border-outline-variant bg-surface-container-low px-md py-xs">
                <h2 className="font-mono text-code-xs font-bold uppercase tracking-wider text-on-surface">
                  Pending Invitations ({pendingInvitations.length})
                </h2>
              </div>
              <div className="divide-y divide-outline-variant">
                {pendingInvitations.map((invitation) => {
                  const roleInfo = roleBadgeConfig[invitation.role]
                  return (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between gap-sm p-sm px-md hover:bg-surface-container-low/50 transition-colors"
                    >
                      <div>
                        <p className="font-mono text-code-sm font-semibold text-on-surface">
                          {invitation.email}
                        </p>
                        <div className="mt-xs flex items-center gap-xs font-mono text-code-xs text-outline">
                          <span
                            className={`rounded border px-xs py-0.5 font-mono text-code-xs font-semibold uppercase ${roleInfo.className}`}
                          >
                            {roleInfo.label}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Clock size={11} />
                            Sent {timeAgo(invitation.created_at)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={cancelingId === invitation.id}
                        onClick={() => handleCancelInvite(invitation.id, invitation.email)}
                        className="rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs font-mono text-code-xs font-semibold text-error hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors disabled:opacity-50"
                      >
                        {cancelingId === invitation.id ? 'Canceling…' : 'Cancel'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Invite Member Modal */}
      {inviteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/50 animate-in fade-in duration-100"
        >
          <div
            onClick={() => {
              if (!inviting) {
                setInviteOpen(false)
                setInviteError(null)
              }
            }}
            className="fixed inset-0"
          />

          <div className="relative z-10 w-full max-w-[440px] rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-sm">
            <div className="flex items-start justify-between gap-xs border-b border-outline-variant pb-xs">
              <div>
                <h2
                  id="invite-modal-title"
                  className="text-headline-md font-bold text-on-surface"
                >
                  Invite Team Member
                </h2>
                <p className="font-mono text-code-xs text-on-surface-variant">
                  Dispatches an enrollment link for project [{currentProject?.key}].
                </p>
              </div>
              <button
                type="button"
                disabled={inviting}
                onClick={() => {
                  setInviteOpen(false)
                  setInviteError(null)
                }}
                className="rounded p-xs text-outline hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {inviteError && (
              <p className="mt-sm rounded border border-rose-500/30 bg-rose-500/10 p-xs text-body-md text-rose-800 dark:text-rose-300">
                {inviteError}
              </p>
            )}

            <form onSubmit={handleInvite} className="mt-md space-y-sm">
              <div>
                <label className="mb-xs block text-label-md font-bold text-on-surface">
                  Email Address <span className="text-error">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="operator@company.com"
                  className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                />
              </div>

              <div>
                <label className="mb-xs block text-label-md font-bold text-on-surface">
                  Assigned Project Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md font-semibold text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                >
                  <option value="DEVELOPER">Developer (Fixes defects & submits builds)</option>
                  <option value="QA">QA Lab (Executes repro steps & verifies fixes)</option>
                  <option value="OWNER">Project Owner (Full administrative permissions)</option>
                </select>
              </div>

              <div className="flex justify-end gap-xs pt-xs">
                <button
                  type="button"
                  disabled={inviting}
                  onClick={() => {
                    setInviteOpen(false)
                    setInviteError(null)
                  }}
                  className="rounded border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="rounded bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                >
                  {inviting ? 'Dispatching…' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
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
    </div>
  )
}

export default Members

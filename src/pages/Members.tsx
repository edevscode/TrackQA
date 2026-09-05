import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  KeyRound,
  LogOut,
  RotateCw,
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

const roleTone: Record<ProjectRole, string> = {
  OWNER: 'bg-primary-fixed text-on-primary-fixed',
  DEVELOPER: 'bg-surface-container text-on-surface-variant',
  QA: 'bg-purple-200 text-purple-900',
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

      // Prefetch notifications while on Members page
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
    const prevRole = members.find((m) => m.user_id === userId)?.role
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)))

    const { error } = await supabase
      .from('project_members')
      .update({ role })
      .eq('project_id', currentProject.id)
      .eq('user_id', userId)

    if (error) {
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role: prevRole ?? m.role } : m)),
      )
      setActionError(error.message)
    } else {
      invalidateMembersCache(currentProject.id)
    }
  }

  const handleRemove = (userId: string, memberName: string) => {
    if (!currentProject || !isOwner) return
    setConfirmModal({
      open: true,
      title: 'Remove Member',
      description: `Are you sure you want to remove ${memberName} from this project? They will immediately lose access to all project issues.`,
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
        load()
      },
    })
  }

  const handleLeave = () => {
    if (!currentProject || !user) return
    setConfirmModal({
      open: true,
      title: 'Leave Workspace',
      description: `Are you sure you want to leave "${currentProject.name}"? You will lose access until you are re-invited.`,
      confirmLabel: 'Leave Workspace',
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

      <div className="flex-1 py-lg">
        <div className="mb-lg flex items-start justify-between gap-md px-lg">
          <div>
            <h1 className="text-headline-xl font-bold text-on-surface">
              Members
            </h1>
            <p className="mt-xs text-body-lg text-on-surface-variant">
              Manage your team and their roles across the project.
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => setInviteOpen((v) => !v)}
              className="flex shrink-0 items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
            >
              <UserPlus size={16} />
              Invite Member
            </button>
          )}
        </div>

        {!isOwner && (
          <p className="mx-lg mb-lg rounded-md bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">
            Only the project owner can invite, change roles, or remove other
            members. You can still leave the project yourself.
          </p>
        )}

        {isOwner && currentProject?.access_code && (
          <div className="mb-lg flex flex-wrap items-center justify-between gap-md border-y border-outline-variant px-lg py-md">
            <div className="flex items-center gap-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                <KeyRound size={20} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-on-surface">
                  Project Access Code
                </p>
                <p className="text-label-md text-on-surface-variant">
                  Teammates can use this code to join this project directly on the Join Workspace page.
                </p>
              </div>
            </div>

            <div className="flex items-center rounded-md border border-outline-variant bg-surface-container-low pl-md pr-xs py-[6px]">
              <span className="font-mono text-body-lg font-bold tracking-wider text-primary mr-sm">
                {currentProject.access_code}
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
          </div>
        )}

        {actionError && (
          <p className="mx-lg mb-lg rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
            {actionError}
          </p>
        )}

        <div className="mb-md flex flex-wrap items-center gap-sm border-y border-outline-variant px-lg py-md">
          <div className="flex min-w-[280px] flex-1 items-center gap-sm rounded-md border border-outline-variant px-md py-sm">
            <Search className="text-outline" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="flex-1 bg-transparent text-body-lg text-on-surface outline-none placeholder:text-outline"
            />
          </div>
          <div className="relative">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as ProjectRole | '')}
              className="appearance-none rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-md pr-xl text-body-md font-medium text-on-surface hover:bg-surface-container-low"
            >
              <option value="">All Roles</option>
              <option value="OWNER">Owner</option>
              <option value="DEVELOPER">Developer</option>
              <option value="QA">QA</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
              size={16}
            />
          </div>
        </div>

        {loading ? (
          <div className="mx-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-xl text-center text-body-lg text-on-surface-variant">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center px-lg text-center text-body-lg text-on-surface-variant">
            No members match these filters.
          </div>
        ) : (
          <div className="border-t border-outline-variant">
            <div className="hidden border-b border-outline-variant px-lg py-sm text-label-md font-semibold uppercase tracking-wide text-on-surface-variant lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_140px_90px] lg:items-center lg:gap-sm xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_140px_90px] xl:gap-lg">
              <span className="min-w-0 truncate">Member</span>
              <span className="min-w-0 truncate">Email</span>
              <span className="min-w-0 truncate">Role</span>
              <span className="min-w-0 truncate">Assigned Issues</span>
              <span className="min-w-0 truncate text-right">Actions</span>
            </div>

            {filtered.map((member) => {
              const leaveButton = member.user_id === user?.id && member.role !== 'OWNER' && (
                <button
                  type="button"
                  aria-label="Leave project"
                  onClick={handleLeave}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container hover:text-rose-600"
                >
                  <LogOut size={18} />
                </button>
              )
              const removeButton = member.user_id !== user?.id && isOwner && (
                <button
                  type="button"
                  aria-label={`Remove ${member.full_name ?? member.email}`}
                  onClick={() => handleRemove(member.user_id, member.full_name ?? member.email)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container hover:text-rose-600"
                >
                  <UserMinus size={18} />
                </button>
              )
              const roleBadge = isOwner ? (
                <span className={`inline-flex rounded-full ${roleTone[member.role]}`}>
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.user_id, e.target.value as ProjectRole)}
                    className="appearance-none bg-transparent px-md py-xs text-label-md font-semibold outline-none"
                  >
                    <option value="OWNER">Project Owner</option>
                    <option value="DEVELOPER">Developer</option>
                    <option value="QA">QA</option>
                  </select>
                </span>
              ) : (
                <span
                  className={`inline-flex rounded-full px-md py-xs text-label-md font-semibold ${roleTone[member.role]}`}
                >
                  {member.role === 'OWNER' ? 'Project Owner' : member.role}
                </span>
              )

              return (
                <div key={member.user_id}>
                  {/* Mobile card */}
                  <div className="border-b border-outline-variant p-lg hover:bg-surface-container-low lg:hidden">
                    <div className="flex items-start gap-sm">
                      <Avatar name={member.full_name} avatarUrl={member.avatar_url} size={36} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-md font-semibold text-on-surface">
                          {member.full_name ?? 'Unnamed'}
                        </p>
                        <p className="truncate text-label-md text-on-surface-variant">{member.email}</p>
                      </div>
                      {roleBadge}
                    </div>
                    <div className="mt-sm flex items-center justify-between gap-sm text-label-md text-on-surface-variant">
                      <span>{member.assigned_issues} assigned issue{member.assigned_issues === 1 ? '' : 's'}</span>
                      {(leaveButton || removeButton) && <div>{leaveButton || removeButton}</div>}
                    </div>
                  </div>

                  {/* Desktop row */}
                  <div className="hidden border-b border-outline-variant px-lg py-md hover:bg-surface-container-low lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_140px_90px] lg:items-center lg:gap-sm xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_140px_90px] xl:gap-lg xl:py-lg">
                    <div className="flex min-w-0 items-center gap-sm">
                      <Avatar name={member.full_name} avatarUrl={member.avatar_url} size={36} className="shrink-0" />
                      <span className="min-w-0 truncate text-body-md font-semibold text-on-surface xl:text-body-lg">
                        {member.full_name ?? 'Unnamed'}
                      </span>
                    </div>
                    <span className="min-w-0 truncate text-body-md text-on-surface-variant xl:text-body-lg">{member.email}</span>
                    <div className="min-w-0">{roleBadge}</div>
                    <span className="min-w-0 text-body-md text-on-surface xl:text-body-lg">{member.assigned_issues}</span>
                    <div className="min-w-0 text-right">{leaveButton || removeButton}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-md flex items-center justify-between px-lg">
          <p className="text-body-md text-on-surface-variant">
            Showing 1 to {filtered.length} of {members.length} members
          </p>
          <div className="flex gap-sm">
            <button
              type="button"
              disabled
              className="rounded-md border border-outline-variant px-md py-sm text-body-md font-medium text-outline disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              type="button"
              disabled
              className="rounded-md border border-outline-variant px-md py-sm text-body-md font-medium text-outline disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>

        {isOwner && pendingInvitations.length > 0 && (
          <div className="mx-lg mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
            <div className="border-b border-outline-variant px-lg py-md">
              <h2 className="text-headline-md font-semibold text-on-surface">
                Pending Invitations
              </h2>
            </div>
            <ul>
              {pendingInvitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-md border-t border-outline-variant px-lg py-md first:border-t-0"
                >
                  <div>
                    <p className="text-body-lg font-semibold text-on-surface">
                      {invitation.email}
                    </p>
                    <div className="mt-xs flex items-center gap-sm text-body-md text-on-surface-variant">
                      <span className={`rounded-full px-sm py-[2px] text-label-md font-semibold ${roleTone[invitation.role]}`}>
                        {invitation.role}
                      </span>
                      <span className="flex items-center gap-xs">
                        <Clock size={14} />
                        Sent {timeAgo(invitation.created_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={cancelingId === invitation.id}
                    onClick={() =>
                      handleCancelInvite(invitation.id, invitation.email)
                    }
                    className="shrink-0 rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
                  >
                    {cancelingId === invitation.id ? 'Canceling…' : 'Cancel'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Invite Member Modal */}
      {inviteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-md"
        >
          {/* Subtle Backdrop */}
          <div
            onClick={() => {
              if (!inviting) {
                setInviteOpen(false)
                setInviteError(null)
              }
            }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[1px] transition-opacity"
          />

          {/* Minimal Card */}
          <div className="relative z-10 w-full max-w-[420px] rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-lg">
            {/* Header */}
            <div className="flex items-start justify-between gap-sm">
              <div>
                <h2
                  id="invite-modal-title"
                  className="text-headline-md font-semibold text-on-surface"
                >
                  Invite Team Member
                </h2>
                <p className="mt-xs text-body-md text-on-surface-variant">
                  Send an email invitation to join this project workspace.
                </p>
              </div>
              <button
                type="button"
                disabled={inviting}
                onClick={() => {
                  setInviteOpen(false)
                  setInviteError(null)
                }}
                aria-label="Close dialog"
                className="-mr-xs -mt-xs rounded p-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:opacity-50 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleInvite} className="mt-md flex flex-col gap-md">
              {inviteError && (
                <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                  {inviteError}
                </p>
              )}

              <div>
                <label
                  htmlFor="inviteEmail"
                  className="mb-xs block text-body-md font-medium text-on-surface"
                >
                  Email address
                </label>
                <input
                  id="inviteEmail"
                  type="email"
                  required
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email ni tropa"
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="inviteRole"
                  className="mb-xs block text-body-md font-medium text-on-surface"
                >
                  Role
                </label>
                <select
                  id="inviteRole"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                >
                  <option value="DEVELOPER">Developer</option>
                  <option value="QA">QA</option>
                  <option value="OWNER">Project Owner</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="mt-sm flex items-center justify-end gap-sm">
                <button
                  type="button"
                  disabled={inviting}
                  onClick={() => {
                    setInviteOpen(false)
                    setInviteError(null)
                  }}
                  className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-medium text-on-surface hover:bg-surface-container-low disabled:opacity-60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center justify-center gap-xs rounded-md bg-primary px-md py-xs text-body-md font-medium text-on-primary hover:bg-primary-container disabled:opacity-60 transition-colors shadow-xs"
                >
                  {inviting && <RotateCw size={14} className="animate-spin" />}
                  {inviting ? 'Sending…' : 'Send Invite'}
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

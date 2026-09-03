import { ArrowLeft, ArrowRight, Bug, KeyRound, Mail, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { supabase } from '../lib/supabase'
import type { ProjectInvitation } from '../lib/database.types'

type InvitationWithProject = ProjectInvitation & {
  projects: {
    name: string
    key: string
    owner: { full_name: string | null; email: string } | null
  } | null
  inviter: { full_name: string | null; email: string } | null
}

function JoinProject() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentProject, refreshProjects, setCurrentProjectId } = useProject()

  const [accessCode, setAccessCode] = useState('')
  const [joiningCode, setJoiningCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const [invitations, setInvitations] = useState<InvitationWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.email) return
    supabase
      .from('project_invitations')
      .select(
        '*, projects(name, key, owner:profiles!projects_owner_id_fkey(full_name, email)), inviter:profiles!project_invitations_invited_by_fkey(full_name, email)',
      )
      .eq('email', user.email.toLowerCase())
      .eq('status', 'PENDING')
      .then(({ data }) => {
        setInvitations((data as InvitationWithProject[]) ?? [])
        setLoading(false)
      })
  }, [user?.email])

  const handleJoinWithCode = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = accessCode.trim().toUpperCase()
    if (!trimmed) {
      setCodeError('Please enter an access code.')
      return
    }

    setJoiningCode(true)
    setCodeError(null)

    const { data, error: rpcError } = await supabase.rpc(
      'join_project_with_access_code',
      { p_access_code: trimmed },
    )

    setJoiningCode(false)
    if (rpcError) {
      if (
        rpcError.message.toLowerCase().includes('invalid access code') ||
        rpcError.message.toLowerCase().includes('archived')
      ) {
        setCodeError('Invalid access code')
      } else {
        setCodeError(rpcError.message)
      }
      return
    }

    await refreshProjects()
    if (data?.id) {
      setCurrentProjectId(data.id)
    }
    navigate('/dashboard')
  }

  const handleAccept = async (invitationId: string) => {
    setBusyId(invitationId)
    setInviteError(null)
    const { data, error: rpcError } = await supabase.rpc(
      'accept_project_invitation',
      { p_invitation_id: invitationId },
    )
    if (rpcError) {
      setInviteError(rpcError.message)
      setBusyId(null)
      return
    }
    await refreshProjects()
    if (data) setCurrentProjectId(data.project_id)
    navigate('/dashboard')
  }

  const handleDecline = async (invitationId: string) => {
    setBusyId(invitationId)
    setInviteError(null)
    const { error: rpcError } = await supabase.rpc(
      'decline_project_invitation',
      { p_invitation_id: invitationId },
    )
    if (rpcError) {
      setInviteError(rpcError.message)
      setBusyId(null)
      return
    }
    setInvitations((prev) => prev.filter((inv) => inv.id !== invitationId))
    setBusyId(null)
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-xl">
      <div className="mb-lg flex flex-col items-center">
        <div className="mb-md flex h-16 w-16 items-center justify-center rounded-xl bg-primary">
          <Bug className="text-on-primary" size={32} />
        </div>
        <h1 className="text-headline-xl font-bold text-on-surface">
          Join a workspace
        </h1>
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Enter an access code or accept a pending invitation to connect with your team.
        </p>
      </div>

      <div className="flex w-full max-w-[580px] flex-col gap-lg">
        {/* Access Code Card */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-xl shadow-raised">
          <div className="flex items-center gap-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
              <KeyRound className="text-primary" size={20} />
            </div>
            <div>
              <h2 className="text-headline-md font-semibold text-on-surface">
                Join with Access Code
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Enter the project access code shared by your project owner or team.
              </p>
            </div>
          </div>

          <form onSubmit={handleJoinWithCode} className="mt-lg flex flex-col gap-md">
            {codeError && (
              <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                {codeError}
              </p>
            )}

            <div>
              <label
                htmlFor="accessCode"
                className="mb-xs block text-body-md font-semibold text-on-surface"
              >
                Project Access Code
              </label>
              <div className="flex gap-sm">
                <input
                  id="accessCode"
                  type="text"
                  maxLength={12}
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A1B2C3D4"
                  className="flex-1 rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm font-mono text-body-lg uppercase tracking-wider text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="submit"
                  disabled={joiningCode || !accessCode.trim()}
                  className="flex items-center gap-xs rounded-md bg-primary px-lg py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60 transition-colors"
                >
                  {joiningCode ? 'Joining…' : 'Join'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Pending Email Invitations Card */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-xl shadow-raised">
          <div className="flex items-center gap-sm mb-lg">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
              <Mail className="text-primary" size={20} />
            </div>
            <div>
              <h2 className="text-headline-md font-semibold text-on-surface">
                Pending Invitations
              </h2>
              <p className="text-body-md text-on-surface-variant">
                Direct invitations sent to <span className="font-semibold text-on-surface">{user?.email}</span>.
              </p>
            </div>
          </div>

          {inviteError && (
            <p className="mb-md rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
              {inviteError}
            </p>
          )}

          {loading ? (
            <p className="text-body-lg text-on-surface-variant">Loading invitations…</p>
          ) : invitations.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              No pending email invitations found. If your team sent you an access code, enter it above.
            </p>
          ) : (
            <ul className="flex flex-col gap-md">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-col gap-md rounded-lg border border-outline-variant p-md sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-sm">
                    <div className="mt-xs flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-container">
                      <UserPlus size={18} />
                    </div>
                    <div>
                      <p className="text-body-lg font-semibold text-on-surface">
                        {invitation.projects?.name ?? 'Unknown project'}
                        {invitation.projects?.key && (
                          <span className="font-normal text-on-surface-variant">
                            {' '}
                            ({invitation.projects.key})
                          </span>
                        )}
                      </p>
                      <p className="mt-xs text-body-md text-on-surface-variant">
                        Invited as <span className="font-semibold text-on-surface">{invitation.role}</span>
                      </p>
                      {invitation.inviter && (
                        <p className="mt-xs text-body-md text-on-surface-variant">
                          {invitation.inviter.email === invitation.projects?.owner?.email
                            ? 'Owner'
                            : 'Invited by'}{' '}
                          <span className="font-medium text-on-surface">
                            {invitation.inviter.full_name ?? invitation.inviter.email}
                          </span>{' '}
                          ({invitation.inviter.email})
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-sm justify-end">
                    <button
                      type="button"
                      disabled={busyId === invitation.id}
                      onClick={() => handleDecline(invitation.id)}
                      className="rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60 transition-colors"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={busyId === invitation.id}
                      onClick={() => handleAccept(invitation.id)}
                      className="rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60 transition-colors"
                    >
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-center">
          <Link
            to={currentProject ? '/dashboard' : '/welcome'}
            className="flex items-center gap-xs text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
          >
            <ArrowLeft size={16} />
            Back to {currentProject ? 'Dashboard' : 'Welcome'}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default JoinProject

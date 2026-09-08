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
        setCodeError('Invalid access code or project is archived')
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
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-lg sm:py-xl">
      <div className="w-full max-w-[580px]">
        {/* Back Link */}
        <Link
          to={currentProject ? '/dashboard' : '/welcome'}
          className="mb-lg inline-flex items-center gap-xs text-body-md font-semibold text-on-surface-variant hover:text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          <span>Back to {currentProject ? 'Dashboard' : 'Projects'}</span>
        </Link>

        {/* Header */}
        <div className="mb-lg flex items-center gap-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-on-primary">
            <Bug size={22} />
          </div>
          <div>
            <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
              Join Project
            </h1>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Connect to an active project via access code or pending team invitation.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-lg">
          {/* Access Code Card */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-lg sm:p-xl">
            <div className="flex items-center gap-sm mb-md">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound size={20} />
              </div>
              <div>
                <h2 className="text-headline-md font-semibold text-on-surface">
                  Join with Access Code
                </h2>
                <p className="text-body-md text-on-surface-variant">
                  Enter the project access code shared by your team lead.
                </p>
              </div>
            </div>

            <form onSubmit={handleJoinWithCode} className="mt-md flex flex-col gap-md">
              {codeError && (
                <div className="rounded-md border border-error/30 bg-error-container px-md py-sm text-body-md font-medium text-on-error-container">
                  {codeError}
                </div>
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
                    onChange={(e) => setAccessCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="e.g. A1B2C3D4"
                    className="flex-1 rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm font-mono text-body-lg uppercase tracking-wider text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={joiningCode || !accessCode.trim()}
                    className="flex items-center gap-xs rounded-md bg-primary px-lg py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60 transition-colors"
                  >
                    <span>{joiningCode ? 'Joining…' : 'Join'}</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Pending Invitations Card */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-lg sm:p-xl">
            <div className="flex items-center gap-sm mb-md">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                <Mail size={20} />
              </div>
              <div>
                <h2 className="text-headline-md font-semibold text-on-surface">
                  Pending Invitations
                </h2>
                <p className="text-body-md text-on-surface-variant">
                  Invitations sent directly to <span className="font-semibold text-on-surface">{user?.email}</span>.
                </p>
              </div>
            </div>

            {inviteError && (
              <div className="mb-md rounded-md border border-error/30 bg-error-container px-md py-sm text-body-md font-medium text-on-error-container">
                {inviteError}
              </div>
            )}

            {loading ? (
              <p className="py-md text-body-md text-on-surface-variant">Checking pending invitations…</p>
            ) : invitations.length === 0 ? (
              <p className="py-md text-body-md text-on-surface-variant">
                No pending email invitations found. If your project team sent an access code, enter it above.
              </p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex flex-col gap-sm rounded-md border border-outline-variant p-md sm:flex-row sm:items-center sm:justify-between hover:bg-surface-container-low transition-colors"
                  >
                    <div className="flex items-start gap-sm">
                      <div className="mt-xs flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-container text-on-surface-variant">
                        <UserPlus size={16} />
                      </div>
                      <div>
                        <p className="text-body-md font-semibold text-on-surface">
                          {invitation.projects?.name ?? 'Unknown project'}
                          {invitation.projects?.key && (
                            <span className="font-mono text-code-xs text-primary font-bold">
                              {' '}[{invitation.projects.key}]
                            </span>
                          )}
                        </p>
                        <p className="mt-xs text-label-md text-on-surface-variant">
                          Role: <span className="font-semibold text-on-surface">{invitation.role}</span>
                          {invitation.inviter && ` · Invited by ${invitation.inviter.full_name ?? invitation.inviter.email}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-xs justify-end">
                      <button
                        type="button"
                        disabled={busyId === invitation.id}
                        onClick={() => handleDecline(invitation.id)}
                        className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-60 transition-colors"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={busyId === invitation.id}
                        onClick={() => handleAccept(invitation.id)}
                        className="rounded-md bg-primary px-md py-xs text-body-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60 transition-colors"
                      >
                        Accept
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default JoinProject

import {
  ArchiveRestore,
  ArrowRight,
  CirclePlus,
  LogOut,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

function Welcome() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [archivedCount, setArchivedCount] = useState<number>(0)
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('project_members')
      .select('project:projects(id, archived)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const count = (data ?? []).filter(
          (row) => (row.project as unknown as { archived?: boolean })?.archived === true,
        ).length
        setArchivedCount(count)
      })
  }, [user])

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-xl">
      {/* Hero Intro */}
      <section className="flex max-w-[620px] flex-col items-center text-center">
        <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
          Quality Assurance Projects
        </h1>
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Initialize a new project repository or connect with your engineering team to begin logging, triaging, and verifying defects.
        </p>
      </section>

      {/* Gateway Cards Grid */}
      <div
        className={`mt-xl grid w-full max-w-[960px] grid-cols-1 gap-lg ${
          archivedCount > 0 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'
        }`}
      >
        {/* Create Project Card */}
        <div className="flex flex-col justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-lg transition-colors hover:border-primary/40">
          <div>
            <div className="flex items-center gap-sm">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <CirclePlus size={20} />
              </div>
              <h2 className="text-headline-md font-semibold text-on-surface">
                Create Project
              </h2>
            </div>
            <p className="mt-sm text-body-md text-on-surface-variant leading-relaxed">
              Start a new testing project. Set up custom issue key prefixes (e.g. <span className="font-mono text-code-xs text-primary font-semibold">[TQA-101]</span>), configure triage parameters, and invite collaborators.
            </p>
          </div>
          <Link
            to="/projects/new"
            className="mt-lg inline-flex items-center justify-center gap-xs rounded-md bg-primary py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
          >
            <span>Start Project</span>
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* Join Project Card */}
        <div className="flex flex-col justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-lg transition-colors hover:border-primary/40">
          <div>
            <div className="flex items-center gap-sm">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                <UserPlus size={20} />
              </div>
              <h2 className="text-headline-md font-semibold text-on-surface">
                Join Project
              </h2>
            </div>
            <p className="mt-sm text-body-md text-on-surface-variant leading-relaxed">
              Already invited to a project? Enter an invitation access code or review pending organization invitations to join an ongoing test cycle.
            </p>
          </div>
          <Link
            to="/projects/join"
            className="mt-lg inline-flex items-center justify-center gap-xs rounded-md border border-outline-variant bg-surface-container-low py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
          >
            <span>Join Project</span>
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* Archived Projects Card (if applicable) */}
        {archivedCount > 0 && (
          <div className="flex flex-col justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-lg transition-colors hover:border-outline">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-sm">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-container text-on-surface-variant">
                    <ArchiveRestore size={20} />
                  </div>
                  <h2 className="text-headline-md font-semibold text-on-surface">
                    Archived
                  </h2>
                </div>
                <span className="rounded bg-surface-container px-sm py-[2px] font-mono text-code-xs font-bold text-on-surface-variant">
                  {archivedCount}
                </span>
              </div>
              <p className="mt-sm text-body-md text-on-surface-variant leading-relaxed">
                You have {archivedCount} archived project{archivedCount === 1 ? '' : 's'}. Review historical test records or restore projects to active status.
              </p>
            </div>
            <Link
              to="/projects/archived"
              className="mt-lg inline-flex items-center justify-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest py-sm text-body-md font-semibold text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
            >
              <span>Manage Archives</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </div>

      {/* Subtle Footer Navigation */}
      <div className="mt-xl flex items-center gap-md text-label-md text-on-surface-variant">
        <Link
          to="/account-settings"
          className="hover:text-primary transition-colors font-medium"
        >
          Account Settings
        </Link>
        <span className="text-outline">•</span>
        <button
          type="button"
          onClick={() => setShowSignOutModal(true)}
          className="hover:text-error transition-colors font-medium"
        >
          Sign Out
        </button>
      </div>

      <ConfirmModal
        open={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleSignOut}
        title="Sign Out"
        description="Are you sure you want to sign out of your TrackQA account?"
        confirmLabel="Sign Out"
        variant="primary"
        icon={<LogOut size={22} className="text-primary" />}
        isLoading={signingOut}
      />
    </div>
  )
}

export default Welcome

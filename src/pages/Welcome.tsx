import {
  ArchiveRestore,
  ArrowRight,
  Bug,
  CirclePlus,
  LogOut,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

function Welcome() {
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
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

  // New user interface: Clean centered hero with ONLY Create and Join cards (no header/signout/account buttons)
  if (archivedCount === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-surface px-md py-xl">
        <div className="mt-xl flex max-w-[560px] flex-col items-center text-center">
          <div className="mb-lg flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Bug className="text-on-primary" size={32} />
          </div>

          <h1 className="text-headline-xl font-bold text-on-surface">
            Welcome to TrackQA
          </h1>
          <p className="mt-sm text-body-lg text-on-surface-variant">
            The modern, frictionless way to manage issues and maintain
            quality. Get started by creating a new workspace or joining your
            team.
          </p>
        </div>

        <div className="mt-xl grid w-full max-w-[900px] grid-cols-1 gap-lg sm:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
            <div className="mb-md flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
              <CirclePlus className="text-on-surface" size={20} />
            </div>
            <h2 className="text-headline-md font-semibold text-on-surface">
              Create New Project
            </h2>
            <p className="mt-xs flex-1 text-body-lg text-on-surface-variant">
              Start fresh with a new workspace. Set up your repositories,
              define issue types, and invite your team to begin tracking
              immediately.
            </p>
            <Link
              to="/projects/new"
              className="mt-md inline-flex items-center gap-xs text-body-lg font-semibold text-primary hover:underline"
            >
              Get Started
              <ArrowRight size={16} />
            </Link>
          </div>

          <div className="flex flex-col rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
            <div className="mb-md flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
              <UserPlus className="text-on-surface" size={20} />
            </div>
            <h2 className="text-headline-md font-semibold text-on-surface">
              Join Existing Project
            </h2>
            <p className="mt-xs flex-1 text-body-lg text-on-surface-variant">
              Already have a team on TrackQA? Enter your invitation code or
              search for your organization to connect with ongoing work.
            </p>
            <Link
              to="/projects/join"
              className="mt-md inline-flex items-center gap-xs text-body-lg font-semibold text-primary hover:underline"
            >
              Find Workspace
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Returning user with 0 active projects but 1+ archived projects
  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-lg">
      <div className="flex w-full max-w-[960px] items-center justify-between pb-md">
        <div className="flex items-center gap-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Bug className="text-on-primary" size={18} />
          </div>
          <span className="text-headline-md font-bold text-primary">TrackQA</span>
        </div>

        <div className="flex items-center gap-sm">
          <Link
            to="/account-settings"
            className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-medium text-on-surface hover:bg-surface-container-low transition-colors"
          >
            <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={24} />
            Account
          </Link>
          <button
            type="button"
            onClick={() => setShowSignOutModal(true)}
            className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-xs text-body-md font-medium text-on-surface hover:bg-surface-container-low transition-colors"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>

      <div className="mt-lg flex max-w-[560px] flex-col items-center text-center">
        <h1 className="text-headline-xl font-bold text-on-surface">
          Welcome to TrackQA
        </h1>
        <p className="mt-sm text-body-lg text-on-surface-variant">
          The modern, frictionless way to manage issues and maintain
          quality. Get started by creating a new workspace, joining your
          team, or restoring an archived project.
        </p>
      </div>

      <div className="mt-xl grid w-full max-w-[960px] grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
          <div className="mb-md flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
            <CirclePlus className="text-on-surface" size={20} />
          </div>
          <h2 className="text-headline-md font-semibold text-on-surface">
            Create New Project
          </h2>
          <p className="mt-xs flex-1 text-body-md text-on-surface-variant">
            Start fresh with a new workspace. Set up your prefix key and
            invite your team to begin tracking immediately.
          </p>
          <Link
            to="/projects/new"
            className="mt-md inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
          >
            Get Started
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
          <div className="mb-md flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
            <UserPlus className="text-on-surface" size={20} />
          </div>
          <h2 className="text-headline-md font-semibold text-on-surface">
            Join Existing Project
          </h2>
          <p className="mt-xs flex-1 text-body-md text-on-surface-variant">
            Already have a team on TrackQA? Enter your invitation code or
            view pending invitations to connect with ongoing work.
          </p>
          <Link
            to="/projects/join"
            className="mt-md inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
          >
            Find Workspace
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-raised">
          <div className="mb-md flex h-10 w-10 items-center justify-center rounded-md bg-surface-container">
            <ArchiveRestore className="text-on-surface" size={20} />
          </div>
          <div className="flex items-center justify-between">
            <h2 className="text-headline-md font-semibold text-on-surface">
              Archived Projects
            </h2>
            <span className="rounded-full bg-surface-container px-sm py-[1px] text-label-md font-bold text-on-surface-variant">
              {archivedCount}
            </span>
          </div>
          <p className="mt-xs flex-1 text-body-md text-on-surface-variant">
            You have {archivedCount} archived workspace{archivedCount === 1 ? '' : 's'}. You can restore
            them anytime to continue tracking issues.
          </p>
          <Link
            to="/projects/archived"
            className="mt-md inline-flex items-center gap-xs text-body-md font-semibold text-primary hover:underline"
          >
            Manage &amp; Restore
            <ArrowRight size={16} />
          </Link>
        </div>
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

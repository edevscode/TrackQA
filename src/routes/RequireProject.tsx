import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { supabase } from '../lib/supabase'

function RequireProject() {
  const { user, loading: authLoading } = useAuth()
  const { currentProject, loading } = useProject()
  const [hasPendingInvite, setHasPendingInvite] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading || currentProject || !user?.email) {
      setHasPendingInvite(null)
      return
    }
    supabase
      .from('project_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('email', user.email.toLowerCase())
      .eq('status', 'PENDING')
      .then(({ count }) => setHasPendingInvite(!!count && count > 0))
  }, [loading, currentProject, user?.email])

  const stillCheckingInvites = !loading && !currentProject && hasPendingInvite === null

  if (authLoading || loading || stillCheckingInvites) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-body-lg text-on-surface-variant">
        Loading…
      </div>
    )
  }

  // Defense in depth: ProtectedRoute already gates this, but if the session
  // died between renders (e.g. mid-navigation), never fall through to
  // treating "no session" as "no projects yet" and sending them to /welcome.
  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!currentProject) {
    // A brand-new user with a pending invitation should land on it directly
    // instead of having to know to click through Welcome -> Join Existing
    // Project themselves.
    return <Navigate to={hasPendingInvite ? '/projects/join' : '/welcome'} replace />
  }

  return <Outlet />
}

export default RequireProject

import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function PublicOnlyRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-body-lg text-on-surface-variant">
        Loading…
      </div>
    )
  }

  if (session) {
    const redirect = new URLSearchParams(window.location.search).get('redirect') || '/dashboard'
    return <Navigate to={redirect} replace />
  }

  return <Outlet />
}

export default PublicOnlyRoute

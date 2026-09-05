import {
  Bell,
  Bug,
  CircleCheck,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import ConfirmModal from './ConfirmModal'
import { useAuth } from '../contexts/AuthContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { supabase } from '../lib/supabase'

const navItems = [
  { label: 'Dashboard', icon: LayoutGrid, to: '/dashboard' },
  { label: 'Issues', icon: Bug, to: '/issues' },
  { label: 'My Tasks', icon: CircleCheck, to: '/my-tasks' },
  { label: 'Members', icon: Users, to: '/members' },
  { label: 'Notifications', icon: Bell, to: '/notifications' },
  { label: 'Project Settings', icon: Settings, to: '/project-settings' },
]

function Sidebar() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const loadUnreadCount = useCallback(async () => {
    if (!user) return
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
    setUnreadCount(count ?? 0)
  }, [user])

  useEffect(() => {
    loadUnreadCount()
  }, [loadUnreadCount])

  useRealtimeSync({
    userId: user?.id,
    onRefresh: loadUnreadCount,
  })

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate('/login')
  }

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="fixed left-md top-md z-30 flex h-10 w-10 items-center justify-center rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface-variant shadow-raised lg:hidden"
        >
          <Menu size={20} />
        </button>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[280px] shrink-0 flex-col overflow-y-auto border-r border-outline-variant bg-surface-container-lowest transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:w-[300px] lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-sm px-lg pt-lg pb-md">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary">
            <Bug className="text-on-primary" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-md font-bold text-primary leading-none">
              TrackQA
            </h1>
            <p className="mt-xs text-label-md text-on-surface-variant">
              Quality Assurance
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-md p-xs text-on-surface-variant hover:bg-surface-container-low lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-lg pt-sm pb-md">
          <Link
            to="/issues/new"
            onClick={() => setMobileOpen(false)}
            className="flex w-full items-center justify-center gap-xs rounded-md bg-primary py-sm text-body-md font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container"
          >
            <Plus size={16} />
            Create Issue
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-xs px-md">
          {navItems.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={label}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-sm rounded-md px-md py-sm text-body-md font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {label === 'Notifications' && unreadCount > 0 && (
                <span className="rounded-full bg-primary-container px-sm py-[1px] text-[11px] font-bold text-on-primary">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col gap-xs border-t border-outline-variant px-md py-md">
          <a
            href="#"
            className="flex items-center gap-sm rounded-md px-md py-sm text-body-md font-medium text-on-surface-variant hover:bg-surface-container-low"
          >
            <HelpCircle size={18} />
            Support
          </a>
          <button
            type="button"
            onClick={() => setShowSignOutModal(true)}
            className="flex items-center gap-sm rounded-md px-md py-sm text-left text-body-md font-medium text-on-surface-variant hover:bg-surface-container-low"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

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
    </>
  )
}

export default Sidebar

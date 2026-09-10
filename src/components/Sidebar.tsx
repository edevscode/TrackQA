import {
  Bug,
  CircleCheck,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import ConfirmModal from './ConfirmModal'
import TrackQALogo from './TrackQALogo'
import { useAuth } from '../contexts/AuthContext'
import { useSidebar } from '../contexts/SidebarContext'

const navItems = [
  { label: 'Dashboard', icon: LayoutGrid, to: '/dashboard' },
  { label: 'Issues', icon: Bug, to: '/issues' },
  { label: 'My Tasks', icon: CircleCheck, to: '/my-tasks' },
  { label: 'Members', icon: Users, to: '/members' },
  { label: 'Project Settings', icon: Settings, to: '/project-settings' },
]

function Sidebar() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar()
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    navigate('/login')
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-outline-variant bg-surface-container-lowest transition-all duration-300 ease-in-out lg:sticky lg:top-0 lg:z-auto ${
          mobileOpen ? 'translate-x-0 w-[240px]' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'lg:w-[64px]' : 'lg:w-[220px]'}`}
      >
        {/* Sidebar Header */}
        <div
          className={`flex items-center pt-md pb-sm ${
            collapsed ? 'lg:justify-center px-xs' : 'justify-between px-md'
          }`}
        >
          <Link
            to="/dashboard"
            className="hover:opacity-90 transition-opacity"
            title={collapsed ? 'TrackQA Dashboard' : undefined}
          >
            <TrackQALogo size="sm" showText={!collapsed} />
          </Link>

          {/* Mobile Close Button only */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            title="Close menu"
            aria-label="Close menu"
            className="rounded-md p-xs text-on-surface-variant hover:bg-surface-container-low lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Create Issue Action */}
        <div className={`pb-sm ${collapsed ? 'px-xs' : 'px-sm pt-xs'}`}>
          <Link
            to="/issues/new"
            onClick={() => setMobileOpen(false)}
            title="Create Issue"
            className={`flex items-center justify-center gap-xs rounded-md bg-primary font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container ${
              collapsed
                ? 'h-10 w-10 mx-auto'
                : 'w-full py-2 text-body-md'
            }`}
          >
            <Plus size={collapsed ? 20 : 16} />
            {!collapsed && <span>Create Issue</span>}
          </Link>
        </div>

        {/* Navigation Items */}
        <nav className={`flex flex-1 flex-col gap-0.5 ${collapsed ? 'px-xs' : 'px-sm'}`}>
          {navItems.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={label}
              to={to}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-md font-medium transition-colors ${
                  collapsed
                    ? 'h-10 w-10 mx-auto justify-center'
                    : 'gap-sm px-sm py-2 text-body-md'
                } ${
                  isActive
                    ? 'bg-primary text-on-primary font-semibold shadow-2xs'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`
              }
            >
              <Icon size={collapsed ? 20 : 18} />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer Utilities */}
        <div className={`flex flex-col gap-0.5 border-t border-outline-variant py-sm ${collapsed ? 'px-xs' : 'px-sm'}`}>
          <NavLink
            to="/support"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? 'Support' : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-md font-medium transition-colors ${
                collapsed
                  ? 'h-10 w-10 mx-auto justify-center'
                  : 'gap-sm px-sm py-2 text-body-md'
              } ${
                isActive
                  ? 'bg-primary-fixed text-on-primary-fixed font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`
            }
          >
            <HelpCircle size={collapsed ? 20 : 18} />
            {!collapsed && <span>Support</span>}
          </NavLink>
          <button
            type="button"
            onClick={() => setShowSignOutModal(true)}
            title={collapsed ? 'Sign Out' : undefined}
            className={`flex items-center rounded-md font-medium text-on-surface-variant hover:bg-surface-container-low ${
              collapsed
                ? 'h-10 w-10 mx-auto justify-center'
                : 'gap-sm px-sm py-2 text-left text-body-md'
            }`}
          >
            <LogOut size={collapsed ? 20 : 18} />
            {!collapsed && <span>Sign Out</span>}
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

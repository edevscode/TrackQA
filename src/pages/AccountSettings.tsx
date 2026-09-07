import { Bell, ChevronRight, Lock, Mail, Pencil, Upload, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, RefObject } from 'react'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import {
  fetchNotificationPreferences,
  invalidateAccountSettingsCache,
  queryCache,
} from '../lib/cache'
import { uploadToCloudinary } from '../lib/cloudinary'
import { supabase } from '../lib/supabase'
import type { NotificationPreferences } from '../lib/database.types'

const tabs = ['Profile Details', 'Notifications', 'Security & Password']

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest disabled:opacity-60'

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="h-5 w-9 rounded-full bg-surface-container-highest transition-colors peer-checked:bg-primary" />
      <div className="absolute left-[2px] h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4" />
    </label>
  )
}

function AccountSettings() {
  const { user, profile, refreshProfile, updatePassword } = useAuth()
  const [tab, setTab] = useState('Profile Details')

  const profileRef = useRef<HTMLFormElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const securityRef = useRef<HTMLDivElement>(null)
  const sectionRefs: Record<string, RefObject<HTMLElement | null>> = {
    'Profile Details': profileRef,
    Notifications: notificationsRef,
    'Security & Password': securityRef,
  }

  const goToTab = (t: string) => {
    setTab(t)
    sectionRefs[t]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [isEditingPersonal, setIsEditingPersonal] = useState(false)
  const [fullName, setFullName] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(() => {
    if (!user?.id) return null
    return queryCache.get<NotificationPreferences>(`account_preferences:${user.id}`)
  })

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
  }, [profile])

  const loadPreferences = useCallback(
    async (forceRefresh = false) => {
      if (!user) return
      const data = await fetchNotificationPreferences(user.id, { forceRefresh })
      setPrefs(data)
    },
    [user],
  )

  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  useRealtimeSync({
    userId: user?.id,
    onRefresh: () => loadPreferences(true),
  })

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSavingProfile(true)
    setProfileError(null)
    setProfileSaved(false)

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user.id)

    setSavingProfile(false)
    if (error) {
      setProfileError(error.message)
      return
    }
    invalidateAccountSettingsCache(user.id)
    setProfileSaved(true)
    setIsEditingPersonal(false)
    await refreshProfile()
  }

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return

    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file.')
      return
    }

    setUploadingAvatar(true)
    setAvatarError(null)

    try {
      const result = await uploadToCloudinary(file, `trackqa/avatars/${user.id}`)
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: result.url })
        .eq('id', user.id)

      if (error) throw error
      invalidateAccountSettingsCache(user.id)
      await refreshProfile()
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleTogglePref = async (
    key: 'email_on_issue_assigned' | 'daily_digest',
    value: boolean,
  ) => {
    if (!user || !prefs) return
    setPrefs({ ...prefs, [key]: value })
    invalidateAccountSettingsCache(user.id)
    const update =
      key === 'email_on_issue_assigned'
        ? { email_on_issue_assigned: value }
        : { daily_digest: value }
    await supabase.from('notification_preferences').update(update).eq('user_id', user.id)
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setSavingPassword(true)
    setPasswordError(null)
    setPasswordSaved(false)

    const { error } = await updatePassword(newPassword)
    setSavingPassword(false)

    if (error) {
      setPasswordError(error)
      return
    }

    setPasswordSaved(true)
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => setPasswordSaved(false), 3000)
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header */}
          <div className="mb-md">
            <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
              Account Parameters
            </h1>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Manage your operator profile, notifications, and security credentials.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-md lg:grid-cols-[220px_1fr]">
            {/* Tabs Sidebar */}
            <div className="h-fit rounded-lg border border-outline-variant bg-surface-container-lowest p-xs space-y-xs">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => goToTab(t)}
                  className={`flex w-full items-center justify-between rounded px-sm py-xs text-left text-body-md font-semibold transition-colors ${
                    tab === t
                      ? 'bg-primary-fixed/40 text-primary'
                      : 'text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span>{t}</span>
                  {tab === t && <ChevronRight size={14} />}
                </button>
              ))}
            </div>

            {/* Main Content */}
            <div className="flex flex-col gap-md">
              {/* Profile Details Section */}
              <form
                ref={profileRef}
                onSubmit={handleSaveProfile}
                className="scroll-mt-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
              >
                <div className="flex items-center justify-between border-b border-outline-variant pb-xs mb-sm">
                  <div className="flex items-center gap-xs">
                    <User className="text-primary" size={18} />
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Operator Identity
                    </h2>
                  </div>
                  {!isEditingPersonal && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileSaved(false)
                        setProfileError(null)
                        setIsEditingPersonal(true)
                      }}
                      className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                    >
                      <Pencil size={13} />
                      <span>Edit Profile</span>
                    </button>
                  )}
                </div>

                <div className="space-y-sm">
                  {profileError && (
                    <p className="rounded border border-rose-500/30 bg-rose-500/10 p-xs text-body-md text-rose-800 dark:text-rose-300">
                      {profileError}
                    </p>
                  )}
                  {profileSaved && (
                    <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-xs text-body-md text-emerald-800 dark:text-emerald-300">
                      Profile changes updated successfully.
                    </p>
                  )}

                  <div className="flex items-center gap-md">
                    <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={56} />
                    {isEditingPersonal && (
                      <div>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarChange}
                          className="hidden"
                        />
                        <button
                          type="button"
                          disabled={uploadingAvatar}
                          onClick={() => avatarInputRef.current?.click()}
                          className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
                        >
                          <Upload size={14} />
                          <span>{uploadingAvatar ? 'Uploading…' : 'Change Avatar'}</span>
                        </button>
                        {avatarError && (
                          <p className="mt-xs text-body-md text-error">{avatarError}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="fullName"
                      className="mb-xs block text-label-md font-bold text-on-surface"
                    >
                      Display Name
                    </label>
                    <input
                      id="fullName"
                      type="text"
                      disabled={!isEditingPersonal}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="email"
                      className="mb-xs block text-label-md font-bold text-on-surface"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-outline"
                        size={16}
                      />
                      <input
                        id="email"
                        type="email"
                        disabled
                        value={profile?.email ?? ''}
                        className={`${inputClass} pl-[36px] font-mono text-code-sm`}
                      />
                    </div>
                  </div>

                  {isEditingPersonal && (
                    <div className="flex justify-end gap-xs pt-xs border-t border-outline-variant">
                      <button
                        type="button"
                        onClick={() => {
                          setFullName(profile?.full_name ?? '')
                          setProfileError(null)
                          setProfileSaved(false)
                          setIsEditingPersonal(false)
                        }}
                        className="rounded border border-outline-variant bg-surface-container-lowest px-md py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="rounded bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                      >
                        {savingProfile ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                </div>
              </form>

              {/* Notifications Preferences Section */}
              <div
                ref={notificationsRef}
                className="scroll-mt-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
              >
                <div className="flex items-center gap-xs border-b border-outline-variant pb-xs mb-sm">
                  <Bell className="text-primary" size={18} />
                  <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                    Notification Routing
                  </h2>
                </div>

                <div className="space-y-sm">
                  <div className="flex items-center justify-between gap-sm rounded border border-outline-variant bg-surface-container-low p-sm">
                    <div>
                      <p className="text-body-md font-semibold text-on-surface">
                        Ticket Assignment Alerts
                      </p>
                      <p className="font-mono text-code-xs text-on-surface-variant">
                        Dispatch email notifications when an issue is assigned to your operator ID.
                      </p>
                    </div>
                    <Toggle
                      checked={prefs?.email_on_issue_assigned ?? false}
                      onChange={(v) => handleTogglePref('email_on_issue_assigned', v)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-sm rounded border border-outline-variant bg-surface-container-low p-sm">
                    <div>
                      <p className="text-body-md font-semibold text-on-surface">
                        Daily QA Digest
                      </p>
                      <p className="font-mono text-code-xs text-on-surface-variant">
                        Morning overview of open defects, verification queues, and sprint statuses.
                      </p>
                    </div>
                    <Toggle
                      checked={prefs?.daily_digest ?? false}
                      onChange={(v) => handleTogglePref('daily_digest', v)}
                    />
                  </div>
                </div>
              </div>

              {/* Password & Security Section */}
              <div
                ref={securityRef}
                className="scroll-mt-md rounded-lg border border-outline-variant bg-surface-container-lowest p-md"
              >
                <div className="flex items-center justify-between border-b border-outline-variant pb-xs mb-sm">
                  <div className="flex items-center gap-xs">
                    <Lock className="text-primary" size={18} />
                    <h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">
                      Security &amp; Password
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasswordOpen((v) => !v)}
                    className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <span>{passwordOpen ? 'Close' : 'Change Password'}</span>
                  </button>
                </div>

                {passwordOpen && (
                  <form onSubmit={handleChangePassword} className="space-y-sm">
                    {passwordError && (
                      <p className="rounded border border-rose-500/30 bg-rose-500/10 p-xs text-body-md text-rose-800 dark:text-rose-300">
                        {passwordError}
                      </p>
                    )}
                    {passwordSaved && (
                      <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-xs text-body-md text-emerald-800 dark:text-emerald-300">
                        Password updated successfully.
                      </p>
                    )}

                    <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="newPassword"
                          className="mb-xs block text-label-md font-bold text-on-surface"
                        >
                          New Password
                        </label>
                        <input
                          id="newPassword"
                          type="password"
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="confirmNewPassword"
                          className="mb-xs block text-label-md font-bold text-on-surface"
                        >
                          Confirm New Password
                        </label>
                        <input
                          id="confirmNewPassword"
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="rounded bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                    >
                      {savingPassword ? 'Updating…' : 'Update Password'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AccountSettings

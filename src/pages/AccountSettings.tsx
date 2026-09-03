import { Bell, ChevronRight, Lock, Mail, Pencil, Upload, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, RefObject } from 'react'
import Avatar from '../components/Avatar'
import Sidebar from '../components/Sidebar'
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
  'w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60'

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
      <div className="h-6 w-11 rounded-full bg-surface-container-highest transition-colors peer-checked:bg-primary" />
      <div className="absolute left-[2px] h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </label>
  )
}

function AccountSettings() {
  const { user, profile, refreshProfile } = useAuth()
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
    e.target.value = '' // allow re-selecting the same file later
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
    setPasswordError(null)
    setPasswordSaved(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }

    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)

    if (error) {
      setPasswordError(error.message)
      return
    }
    setPasswordSaved(true)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="mx-auto w-full max-w-[1280px] flex-1 px-lg py-lg">
        <h1 className="text-headline-xl font-bold text-on-surface">
          Account Settings
        </h1>
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Manage your personal information and preferences.
        </p>

        <div className="mt-lg mb-lg border-t border-outline-variant" />

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-[220px_1fr]">
          <div className="h-fit rounded-lg border border-outline-variant bg-surface-container-lowest p-sm">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => goToTab(t)}
                className={`flex w-full items-center justify-between rounded-md px-md py-sm text-left text-body-md font-medium transition-colors ${
                  tab === t
                    ? 'bg-primary-fixed text-primary'
                    : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                {t}
                {tab === t && <ChevronRight size={16} />}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-lg">
            <form
              ref={profileRef}
              onSubmit={handleSaveProfile}
              className="scroll-mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest"
            >
              <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
                <div>
                  <div className="flex items-center gap-sm">
                    <User className="text-primary" size={22} />
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      Personal Information
                    </h2>
                  </div>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Update your name and email address used for login and
                    notifications.
                  </p>
                </div>
                {!isEditingPersonal && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileSaved(false)
                      setProfileError(null)
                      setIsEditingPersonal(true)
                    }}
                    className="flex shrink-0 items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container"
                  >
                    <Pencil size={16} />
                    Edit
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-md p-lg">
                {profileError && (
                  <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                    {profileError}
                  </p>
                )}
                {profileSaved && (
                  <p className="rounded-md bg-emerald-50 px-md py-sm text-body-md text-emerald-800">
                    Saved.
                  </p>
                )}

                <div className="flex items-center gap-md">
                  <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={64} />
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
                        className="flex items-center gap-xs rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
                      >
                        <Upload size={16} />
                        {uploadingAvatar ? 'Uploading…' : 'Change Photo'}
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
                    className="mb-sm block text-body-md font-semibold text-on-surface"
                  >
                    Full Name
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
                    className="mb-sm block text-body-md font-semibold text-on-surface"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-outline"
                      size={18}
                    />
                    <input
                      id="email"
                      type="email"
                      disabled
                      value={profile?.email ?? ''}
                      className={`${inputClass} pl-[44px]`}
                    />
                  </div>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Managed by your sign-in method. Contact support to change
                    it.
                  </p>
                </div>
              </div>

              {isEditingPersonal && (
                <div className="flex justify-end gap-md rounded-b-lg border-t border-outline-variant bg-surface-container-low px-lg py-md">
                  <button
                    type="button"
                    onClick={() => {
                      setFullName(profile?.full_name ?? '')
                      setProfileError(null)
                      setProfileSaved(false)
                      setIsEditingPersonal(false)
                    }}
                    className="rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                  >
                    {savingProfile ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              )}
            </form>

            <div
              ref={notificationsRef}
              className="scroll-mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest"
            >
              <div className="border-b border-outline-variant px-lg py-lg">
                <div className="flex items-center gap-sm">
                  <Bell className="text-primary" size={22} />
                  <h2 className="text-headline-md font-semibold text-on-surface">
                    Notification Preferences
                  </h2>
                </div>
                <p className="mt-xs text-body-md text-on-surface-variant">
                  Control how and when you receive alerts.
                </p>
              </div>

              <div className="flex flex-col gap-md p-lg">
                <div className="flex items-center justify-between gap-md rounded-md border border-outline-variant p-md">
                  <div>
                    <p className="text-body-lg font-semibold text-on-surface">
                      Issue Assignments
                    </p>
                    <p className="mt-xs text-body-md text-on-surface-variant">
                      Receive email when an issue is assigned to you.
                    </p>
                  </div>
                  <Toggle
                    checked={prefs?.email_on_issue_assigned ?? false}
                    onChange={(v) => handleTogglePref('email_on_issue_assigned', v)}
                  />
                </div>

                <div className="flex items-center justify-between gap-md rounded-md border border-outline-variant p-md">
                  <div>
                    <p className="text-body-lg font-semibold text-on-surface">
                      Daily Digest
                    </p>
                    <p className="mt-xs text-body-md text-on-surface-variant">
                      A daily summary of activity in your watched projects.
                    </p>
                  </div>
                  <Toggle
                    checked={prefs?.daily_digest ?? false}
                    onChange={(v) => handleTogglePref('daily_digest', v)}
                  />
                </div>
              </div>
            </div>

            <div
              ref={securityRef}
              className="scroll-mt-lg rounded-lg border border-outline-variant bg-surface-container-lowest px-lg py-lg"
            >
              <div className="flex items-center justify-between gap-md">
                <div>
                  <div className="flex items-center gap-sm">
                    <Lock className="text-primary" size={22} />
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      Password &amp; Security
                    </h2>
                  </div>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Ensure your account is using a strong password.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPasswordOpen((v) => !v)}
                  className="flex shrink-0 items-center gap-xs rounded-md border border-outline-variant px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container-low"
                >
                  Change Password
                  <ChevronRight size={16} />
                </button>
              </div>

              {passwordOpen && (
                <form onSubmit={handleChangePassword} className="mt-lg flex flex-col gap-md">
                  {passwordError && (
                    <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
                      {passwordError}
                    </p>
                  )}
                  {passwordSaved && (
                    <p className="rounded-md bg-emerald-50 px-md py-sm text-body-md text-emerald-800">
                      Password updated.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-md md:grid-cols-2">
                    <div>
                      <label htmlFor="newPassword" className="mb-sm block text-body-md font-semibold text-on-surface">
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
                      <label htmlFor="confirmNewPassword" className="mb-sm block text-body-md font-semibold text-on-surface">
                        Confirm Password
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
                    className="self-start rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                  >
                    {savingPassword ? 'Updating…' : 'Update Password'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AccountSettings

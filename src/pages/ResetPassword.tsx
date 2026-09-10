import { Check, Eye, EyeOff, Lock } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShowcasePanel from '../components/AuthShowcasePanel'
import TrackQALogo from '../components/TrackQALogo'
import { useAuth } from '../contexts/AuthContext'

function ResetPassword() {
  const navigate = useNavigate()
  const { session, loading, updatePassword, signOut } = useAuth()

  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await updatePassword(password)
    setSubmitting(false)

    if (updateError) {
      setError(updateError)
      return
    }
    setDone(true)
  }

  const handleContinue = async () => {
    await signOut()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container-lowest text-sm text-on-surface-variant">
        Validating session token…
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex min-h-screen bg-surface-container-lowest">
        {/* Left Column */}
        <div className="flex flex-1 flex-col justify-between px-6 py-8 sm:px-12 md:px-16 lg:w-1/2 lg:flex-initial lg:py-12">
          <div className="lg:hidden">
            <Link
              to="/"
              className="inline-flex items-center hover:opacity-90 transition-opacity"
            >
              <TrackQALogo size="md" />
            </Link>
          </div>

          <div className="my-auto mx-auto w-full max-w-[420px] py-8 text-center sm:text-left">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Password updated
            </h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              Your credentials have been successfully updated. You can now sign in with your new password.
            </p>
            <div className="mt-6">
              <button
                type="button"
                onClick={handleContinue}
                className="inline-flex rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-on-primary hover:bg-primary-container transition-colors shadow-xs"
              >
                Proceed to Sign in
              </button>
            </div>
          </div>

          <div className="text-xs text-outline">
            © {new Date().getFullYear()} TrackQA. All rights reserved.
          </div>
        </div>

        {/* Right Column: Visual Showcase Panel */}
        <AuthShowcasePanel />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-screen bg-surface-container-lowest">
        {/* Left Column */}
        <div className="flex flex-1 flex-col justify-between px-6 py-8 sm:px-12 md:px-16 lg:w-1/2 lg:flex-initial lg:py-12">
          <div className="lg:hidden">
            <Link
              to="/"
              className="inline-flex items-center hover:opacity-90 transition-opacity"
            >
              <TrackQALogo size="md" />
            </Link>
          </div>

          <div className="my-auto mx-auto w-full max-w-[420px] py-8 text-center sm:text-left">
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Session expired
            </h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              This password recovery link has expired or is invalid. Request a new link to continue.
            </p>
            <div className="mt-6">
              <Link
                to="/forgot-password"
                className="inline-flex rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-on-primary hover:bg-primary-container transition-colors shadow-xs"
              >
                Request new link
              </Link>
            </div>
          </div>

          <div className="text-xs text-outline">
            © {new Date().getFullYear()} TrackQA. All rights reserved.
          </div>
        </div>

        {/* Right Column: Visual Showcase Panel */}
        <AuthShowcasePanel />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-surface-container-lowest">
      {/* Left Column: Form Canvas */}
      <div className="flex flex-1 flex-col justify-between px-6 py-8 sm:px-12 md:px-16 lg:w-1/2 lg:flex-initial lg:py-12">
        {/* TrackQA Official Logo (Mobile only) */}
        <div className="lg:hidden">
          <Link
            to="/"
            className="inline-flex items-center hover:opacity-90 transition-opacity"
          >
            <TrackQALogo size="md" />
          </Link>
        </div>

        {/* Centered Form Body */}
        <div className="my-auto mx-auto w-full max-w-[420px] py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Set new password
            </h1>
            <p className="mt-1.5 text-sm text-on-surface-variant">
              Please choose a new password for your account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-300">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-on-surface"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1.5 block text-sm font-semibold text-on-surface"
              >
                Confirm password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <Lock
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-outline"
                  size={16}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full rounded-lg bg-primary py-3 text-sm font-bold text-on-primary hover:bg-primary-container active:scale-[0.99] transition-all disabled:opacity-50 shadow-xs"
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-on-surface-variant">
            Remember your credentials?{' '}
            <Link to="/login" className="font-bold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        {/* Bottom Footer */}
        <div className="text-xs text-outline">
          © {new Date().getFullYear()} TrackQA. All rights reserved.
        </div>
      </div>

      {/* Right Column: Visual Showcase Panel */}
      <AuthShowcasePanel />
    </div>
  )
}

export default ResetPassword

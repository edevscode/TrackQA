import { Bug, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
      <div className="flex min-h-screen items-center justify-center bg-surface text-body-lg text-on-surface-variant">
        Loading…
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-xl text-center">
        <h1 className="text-headline-xl font-bold text-on-surface">
          Password updated
        </h1>
        <p className="mt-sm max-w-[440px] text-body-lg text-on-surface-variant">
          Your password has been changed. Sign in again with your new
          password.
        </p>
        <button
          type="button"
          onClick={handleContinue}
          className="mt-lg rounded-md bg-primary px-lg py-sm text-body-lg font-semibold text-on-primary shadow-raised hover:bg-primary-container"
        >
          Back to login
        </button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-xl text-center">
        <h1 className="text-headline-xl font-bold text-on-surface">
          This link has expired
        </h1>
        <p className="mt-sm max-w-[440px] text-body-lg text-on-surface-variant">
          Password reset links are only valid for a short time. Request a new
          one to continue.
        </p>
        <Link
          to="/forgot-password"
          className="mt-lg rounded-md bg-primary px-lg py-sm text-body-lg font-semibold text-on-primary shadow-raised hover:bg-primary-container"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-xl">
      <div className="flex flex-col items-center">
        <div className="mb-md flex h-16 w-16 items-center justify-center rounded-xl bg-primary">
          <Bug className="text-on-primary" size={32} />
        </div>
        <h1 className="text-headline-xl font-bold text-primary">TrackQA</h1>
      </div>

      <div className="mt-xl w-full max-w-[440px] rounded-lg border border-outline-variant bg-surface-container-lowest p-xl shadow-raised">
        <div className="mb-lg text-center">
          <h2 className="text-headline-lg font-bold text-on-surface">
            Choose a new password
          </h2>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Enter and confirm your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          {error && (
            <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div>
            <label
              htmlFor="password"
              className="mb-xs block text-body-md font-semibold text-on-surface"
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
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-md top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-sm w-full rounded-md bg-primary py-sm text-body-lg font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container disabled:opacity-60"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ResetPassword

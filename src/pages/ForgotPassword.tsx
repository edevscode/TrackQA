import { ArrowLeft, Bug, Mail } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function ForgotPassword() {
  const { requestPasswordReset } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: resetError } = await requestPasswordReset(email.trim())

    setSubmitting(false)
    if (resetError) {
      setError(resetError)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-xl text-center">
        <div className="mb-md flex h-16 w-16 items-center justify-center rounded-xl bg-primary">
          <Mail className="text-on-primary" size={32} />
        </div>
        <h1 className="text-headline-xl font-bold text-on-surface">
          Check your email
        </h1>
        <p className="mt-sm max-w-[440px] text-body-lg text-on-surface-variant">
          If an account exists for <strong>{email}</strong>, we sent a link to
          reset your password. Click it to choose a new one.
        </p>
        <Link
          to="/login"
          className="mt-lg rounded-md bg-primary px-lg py-sm text-body-lg font-semibold text-on-primary shadow-raised hover:bg-primary-container"
        >
          Back to login
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
            Forgot your password?
          </h2>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Enter your email and we'll send you a link to reset it.
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
              htmlFor="email"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Email address
            </label>
            <div className="relative">
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <Mail
                className="pointer-events-none absolute right-md top-1/2 -translate-y-1/2 text-outline"
                size={18}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-sm w-full rounded-md bg-primary py-sm text-body-lg font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <Link
          to="/login"
          className="mt-lg flex items-center justify-center gap-xs text-body-md font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} />
          Back to login
        </Link>
      </div>
    </div>
  )
}

export default ForgotPassword

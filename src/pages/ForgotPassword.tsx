import { ArrowLeft, Mail } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthShowcasePanel from '../components/AuthShowcasePanel'
import TrackQALogo from '../components/TrackQALogo'
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
      <div className="flex min-h-screen bg-surface-container-lowest">
        {/* Left Column: Confirmation Canvas */}
        <div className="flex flex-1 flex-col justify-between px-6 py-8 sm:px-12 md:px-16 lg:w-1/2 lg:flex-initial lg:py-12">
          {/* Logo with Bug Icon (Mobile only) */}
          <div className="lg:hidden">
            <Link
              to="/"
              className="inline-flex items-center hover:opacity-90 transition-opacity"
            >
              <TrackQALogo size="md" />
            </Link>
          </div>

          <div className="my-auto mx-auto w-full max-w-[420px] py-8 text-center sm:text-left">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-fixed text-primary">
              <Mail size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              If an account exists for <strong className="text-on-surface">{email}</strong>, a password reset link has been dispatched to your inbox.
            </p>
            <div className="mt-6">
              <Link
                to="/login"
                className="inline-flex rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-on-primary hover:bg-primary-container transition-colors shadow-xs"
              >
                Back to Sign in
              </Link>
            </div>
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
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors mb-4"
            >
              <ArrowLeft size={14} />
              <span>Back to Sign in</span>
            </Link>
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Reset password
            </h1>
            <p className="mt-1.5 text-sm text-on-surface-variant">
              Enter your email address and we'll send you recovery instructions.
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
                htmlFor="email"
                className="mb-1.5 block text-sm font-semibold text-on-surface"
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
                  placeholder="name@company.com"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <Mail
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
              {submitting ? 'Sending instructions…' : 'Send reset link'}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-on-surface-variant">
            Remember your password?{' '}
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

export default ForgotPassword

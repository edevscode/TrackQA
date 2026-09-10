import { Check, Circle, Eye, EyeOff, Lock, Mail, User } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShowcasePanel from '../components/AuthShowcasePanel'
import GoogleIcon from '../components/GoogleIcon'
import TrackQALogo from '../components/TrackQALogo'
import { useAuth } from '../contexts/AuthContext'

const requirements = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'One uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'One number', test: (pw: string) => /[0-9]/.test(pw) },
  {
    label: 'One special character',
    test: (pw: string) => /[^A-Za-z0-9]/.test(pw),
  },
]

function SignUp() {
  const navigate = useNavigate()
  const { signUp, signInWithGoogle } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  const allRequirementsMet = requirements.every((r) => r.test(password))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!allRequirementsMet) {
      setError('Password does not meet the complexity requirements below.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: signUpError, needsEmailConfirmation } = await signUp(
      email,
      password,
      fullName,
    )

    if (signUpError) {
      setError(signUpError)
      setSubmitting(false)
      return
    }

    if (needsEmailConfirmation) {
      setCheckEmail(true)
      setSubmitting(false)
      return
    }

    navigate('/welcome')
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setGoogleSubmitting(true)
    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setError(googleError)
      setGoogleSubmitting(false)
    }
  }

  if (checkEmail) {
    return (
      <div className="flex min-h-screen bg-surface-container-lowest">
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
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-fixed text-primary">
              <Mail size={24} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-on-surface-variant">
              We sent a verification link to <strong className="text-on-surface">{email}</strong>. Click the link in the email to activate your account.
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
        <div className="my-auto mx-auto w-full max-w-[440px] py-8">
          <div className="mb-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-on-surface">
              Create an account
            </h1>
            <p className="mt-1.5 text-sm text-on-surface-variant">
              Start tracking and verifying bugs with your team
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-800 dark:text-rose-300">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="fullName"
                className="mb-1 block text-sm font-semibold text-on-surface"
              >
                Full name
              </label>
              <div className="relative">
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  placeholder="Enter your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <User
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-outline"
                  size={16}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-semibold text-on-surface"
              >
                Email address
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <Mail
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-outline"
                  size={16}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-semibold text-on-surface"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
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
                  className="mb-1 block text-sm font-semibold text-on-surface"
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
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                  />
                  <Lock
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-outline"
                    size={16}
                  />
                </div>
              </div>
            </div>

            {/* Password Complexity Checklist */}
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-2.5 text-xs">
              <span className="mb-1.5 block font-bold text-on-surface">
                Password requirements:
              </span>
              <div className="grid grid-cols-2 gap-1">
                {requirements.map((req) => {
                  const met = req.test(password)
                  return (
                    <div
                      key={req.label}
                      className={`flex items-center gap-1.5 ${
                        met ? 'text-emerald-700 font-semibold' : 'text-on-surface-variant'
                      }`}
                    >
                      {met ? (
                        <Check size={13} className="text-emerald-600 shrink-0" />
                      ) : (
                        <Circle size={9} className="text-outline shrink-0 opacity-60" />
                      )}
                      <span>{req.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-lg bg-primary py-3 text-sm font-bold text-on-primary hover:bg-primary-container active:scale-[0.99] transition-all disabled:opacity-50 shadow-xs"
            >
              {submitting ? 'Creating account…' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleSubmitting}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-container hover:border-outline transition-all disabled:opacity-50"
            >
              <GoogleIcon size={18} />
              <span>Sign up with Google</span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-on-surface-variant">
            Already have an account?{' '}
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

export default SignUp

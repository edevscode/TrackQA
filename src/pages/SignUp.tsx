import { Bug, CircleCheck, KeyRound, Lock, Mail, User } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GoogleIcon from '../components/GoogleIcon'
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
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  const allRequirementsMet = requirements.every((r) => r.test(password))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!allRequirementsMet) {
      setError('Password does not meet the requirements below.')
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
    // On success the browser navigates to Google, so no further action here.
  }

  if (checkEmail) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-xl text-center">
        <div className="mb-md flex h-16 w-16 items-center justify-center rounded-xl bg-primary">
          <Mail className="text-on-primary" size={32} />
        </div>
        <h1 className="text-headline-xl font-bold text-on-surface">
          Check your email
        </h1>
        <p className="mt-sm max-w-[440px] text-body-lg text-on-surface-variant">
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          finish creating your account, then log in.
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
        <p className="mt-xs text-body-lg text-on-surface-variant">
          Create your account
        </p>
      </div>

      <div className="mt-xl w-full max-w-[560px] rounded-lg border border-outline-variant bg-surface-container-lowest p-xl shadow-raised">
        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          {error && (
            <p className="rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
              {error}
            </p>
          )}
          <div>
            <label
              htmlFor="fullName"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Full Name
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-outline"
                size={18}
              />
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                required
                placeholder="Fullname mo boii"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-[44px] pr-md text-body-lg text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Email address
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-outline"
                size={18}
              />
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="Email mo gago"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-[44px] pr-md text-body-lg text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-outline"
                size={18}
              />
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-[44px] pr-md text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Confirm Password
            </label>
            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-outline"
                size={18}
              />
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-sm pl-[44px] pr-md text-body-lg text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="rounded-md bg-surface-container-low p-md">
            <p className="mb-sm text-body-md font-semibold text-on-surface">
              Password must contain:
            </p>
            <ul className="flex flex-col gap-xs">
              {requirements.map((req) => {
                const met = req.test(password)
                return (
                  <li
                    key={req.label}
                    className={`flex items-center gap-sm text-body-md ${
                      met ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  >
                    <CircleCheck size={16} />
                    {req.label}
                  </li>
                )
              })}
            </ul>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-sm w-full rounded-md bg-primary py-sm text-body-lg font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container disabled:opacity-60"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="my-lg flex items-center gap-sm">
          <div className="h-px flex-1 bg-outline-variant" />
          <span className="text-body-md text-on-surface-variant">or</span>
          <div className="h-px flex-1 bg-outline-variant" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleSubmitting}
          className="flex w-full items-center justify-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest py-sm text-body-lg font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-60"
        >
          <GoogleIcon />
          {googleSubmitting ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <p className="mt-lg text-center text-body-md text-on-surface-variant">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Log in instead
          </Link>
        </p>
      </div>

      <p className="mt-lg text-body-md text-on-surface-variant">
        Secure, fast, and simpler than your concubine.
      </p>
    </div>
  )
}

export default SignUp

import { Eye, EyeOff, Mail } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GoogleIcon from '../components/GoogleIcon'
import { useAuth } from '../contexts/AuthContext'

function Login() {
  const navigate = useNavigate()
  const { signIn, signInWithGoogle } = useAuth()

  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setError(signInError)
      setSubmitting(false)
      return
    }

    navigate('/dashboard')
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

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface px-md py-xl">
      <h1 className="mb-xl text-[28px] font-bold tracking-tight text-primary">
        TrackQA
      </h1>

      <div className="w-full max-w-[440px] rounded-lg border border-outline-variant bg-surface-container-lowest p-xl shadow-raised">
        <div className="mb-lg text-center">
          <h2 className="text-headline-lg font-bold text-on-surface">
            Welcome back
          </h2>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Sign in to your account to continue
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

          <div>
            <label
              htmlFor="password"
              className="mb-xs block text-body-md font-semibold text-on-surface"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
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

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-sm text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
              />
              Remember me
            </label>
            <a
              href="#"
              className="text-body-md font-semibold text-primary hover:underline"
            >
              Forgot password?
            </a>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-sm w-full rounded-md bg-primary py-sm text-body-lg font-semibold text-on-primary shadow-raised transition-colors hover:bg-primary-container disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
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
          Don't have an account?{' '}
          <Link to="/signup" className="font-semibold text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>

      <p className="mt-xl text-body-md text-on-surface-variant">
        © 2024 TrackQA. All rights reserved.
      </p>
    </div>
  )
}

export default Login

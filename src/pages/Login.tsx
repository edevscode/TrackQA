import { Eye, EyeOff, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShowcasePanel from '../components/AuthShowcasePanel'
import GoogleIcon from '../components/GoogleIcon'
import TrackQALogo from '../components/TrackQALogo'
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

  // Load remembered email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('trackqa_remembered_email')
    const wasRemembered = localStorage.getItem('trackqa_remember_me') === 'true'
    if (savedEmail && wasRemembered) {
      setEmail(savedEmail)
      setRememberMe(true)
    }
  }, [])

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

    // Persist or clear remembered email
    if (rememberMe) {
      localStorage.setItem('trackqa_remembered_email', email.trim())
      localStorage.setItem('trackqa_remember_me', 'true')
    } else {
      localStorage.removeItem('trackqa_remembered_email')
      localStorage.removeItem('trackqa_remember_me')
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
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-on-surface-variant">
              Please enter your details
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                />
                <Mail
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-outline"
                  size={16}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-on-surface"
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
                  placeholder="••••••••"
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

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-on-surface cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/20"
                />
                <span className="text-xs text-on-surface-variant">Remember me</span>
              </label>

              <Link
                to="/forgot-password"
                className="text-xs font-semibold text-primary hover:underline"
              >
                Forgot password
              </Link>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full rounded-lg bg-primary py-3 text-sm font-bold text-on-primary hover:bg-primary-container active:scale-[0.99] transition-all disabled:opacity-50 shadow-xs"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleSubmitting}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-container hover:border-outline transition-all disabled:opacity-50"
            >
              <GoogleIcon size={18} />
              <span>Sign in with Google</span>
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-on-surface-variant">
            Don't have an account?{' '}
            <Link to="/signup" className="font-bold text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </div>

        {/* Bottom Footer */}
        <div className="text-xs text-outline">
          © {new Date().getFullYear()} TrackQA. All rights reserved.
        </div>
      </div>

      {/* Right Column: Visual Showcase Panel (100% Vector SVG & Bold Typography) */}
      <AuthShowcasePanel />
    </div>
  )
}

export default Login

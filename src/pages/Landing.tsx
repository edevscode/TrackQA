import {
  ArrowRight,
  Bug,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  FileCheck,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Menu,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import TrackQALogo from '../components/TrackQALogo'
import { useAuth } from '../contexts/AuthContext'

const HOW_IT_WORKS_STEPS = [
  {
    stepNumber: '1',
    title: 'Report the bug with clear steps',
    description:
      'Anyone on your team can report an issue with the exact steps to recreate it and the device or browser where it happened. No more vague "it does not work" messages.',
    highlight: 'Includes exact device, browser, and 1-2-3 reproduction steps.',
  },
  {
    stepNumber: '2',
    title: 'Developer reproduces and fixes it',
    description:
      'The assigned developer sees the exact steps and device info right away. They fix the issue and move it to "For Testing" so the tester knows it is ready to check.',
    highlight: 'No back-and-forth guessing: the developer can reproduce it immediately.',
  },
  {
    stepNumber: '3',
    title: 'Tester verifies the fix (Pass or Fail)',
    description:
      'The tester tries out the fix. If it is fixed, they mark it "Passed". If it is still broken, they mark it "Failed" and add a quick note on what went wrong.',
    highlight: 'Clear Pass / Fail records with tester notes and attachments.',
  },
  {
    stepNumber: '4',
    title: 'Release software with confidence',
    description:
      'An issue is only marked as Done once it has been verified and confirmed working. Your team always knows what is actually tested and ready to release.',
    highlight: 'Zero unverified bugs sneaking into your live app.',
  },
]

const COMPARISON_ROWS = [
  {
    feature: 'Steps to reproduce',
    general: 'Usually just a blank text box where steps get forgotten or skipped',
    trackqa: 'Dedicated fields for device, browser, and step-by-step instructions',
  },
  {
    feature: 'Testing workflow',
    general: 'Anyone can drag a card straight to "Done" without verifying the fix',
    trackqa: 'Dedicated "For Testing" queue so fixes are actually checked before closing',
  },
  {
    feature: 'Test results',
    general: 'Buried inside long comment threads or informal chat messages',
    trackqa: 'Clear Pass or Fail verdict cards with tester notes and screenshots',
  },
  {
    feature: 'Inviting your team',
    general: 'Complex seat configurations and admin permissions',
    trackqa: 'Simple 6-digit access code: share it and teammates join instantly',
  },
]

function Landing() {
  const { session } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeStep, setActiveStep] = useState(0)

  // Interactive App Simulation State
  const [simStatus, setSimStatus] = useState<'FOR_TESTING' | 'PASSED' | 'FAILED'>('FOR_TESTING')
  const [simNote, setSimNote] = useState('Tested on iPhone 15: Login works immediately now in under 1 second. Approved!')

  const handlePass = () => {
    setSimStatus('PASSED')
    setSimNote('Tested on physical iPhone 15 (Safari): The login button responds immediately, authentication succeeds in under a second, and opens the dashboard without hanging. Approved for release!')
  }

  const handleFail = () => {
    setSimStatus('FAILED')
    setSimNote('Tested on physical iPhone 15 (Safari): Tapping the login button still spins indefinitely. Bug is not resolved. Sending back to David for investigation.')
  }

  const handleReset = () => {
    setSimStatus('FOR_TESTING')
    setSimNote('')
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface selection:bg-primary selection:text-on-primary">
      {/* 1. TOP NAVIGATION BAR (TALLER & SPACIOUS) */}
      <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface-container-lowest/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-md py-md sm:px-lg sm:py-5">
          <div className="flex items-center gap-sm">
            <Link to="/" className="hover:opacity-90 transition-opacity">
              <TrackQALogo size="md" />
            </Link>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden items-center gap-lg text-base font-medium text-on-surface-variant md:flex">
            <a href="#app-simulation" className="hover:text-on-surface transition-colors">
              App Simulation
            </a>
            <a href="#how-it-works" className="hover:text-on-surface transition-colors">
              How It Works
            </a>
            <a href="#features" className="hover:text-on-surface transition-colors">
              Features
            </a>
            <a href="#comparison" className="hover:text-on-surface transition-colors">
              Why TrackQA
            </a>
          </nav>

          {/* Desktop Action Buttons */}
          <div className="hidden items-center gap-sm md:flex">
            {session ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-xs rounded-md bg-primary px-6 py-2.5 text-sm font-bold text-on-primary hover:bg-primary-container transition-colors shadow-xs"
              >
                <span>Go to Dashboard</span>
                <ArrowRight size={16} />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-md px-4 py-2.5 text-sm font-bold text-on-surface hover:bg-surface-container transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-xs rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-on-primary hover:bg-primary-container transition-colors shadow-xs"
                >
                  <span>Create Account</span>
                  <ArrowRight size={16} />
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="rounded-md p-2 text-on-surface hover:bg-surface-container transition-colors md:hidden"
            title="Toggle navigation menu"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="border-t border-outline-variant bg-surface-container-lowest px-md py-md md:hidden">
            <nav className="flex flex-col gap-sm text-base font-medium text-on-surface-variant">
              <a
                href="#app-simulation"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-sm py-2 hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                App Simulation
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-sm py-2 hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                How It Works
              </a>
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-sm py-2 hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                Features
              </a>
              <a
                href="#comparison"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-sm py-2 hover:bg-surface-container hover:text-on-surface transition-colors"
              >
                Why TrackQA
              </a>
            </nav>
            <div className="mt-md flex flex-col gap-sm border-t border-outline-variant pt-md">
              {session ? (
                <Link
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-xs rounded-md bg-primary py-3 text-base font-bold text-on-primary"
                >
                  <span>Go to Dashboard</span>
                  <ArrowRight size={18} />
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center rounded-md border border-outline-variant py-3 text-base font-bold text-on-surface"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center gap-xs rounded-md bg-primary py-3 text-base font-bold text-on-primary"
                  >
                    <span>Create Account</span>
                    <ArrowRight size={18} />
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* 2. HERO SECTION */}
      <section className="border-b border-outline-variant bg-surface px-md py-xl sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[840px] text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-on-surface sm:text-5xl lg:text-6xl">
            The simple bug tracker built for developers and testers.
          </h1>

          <p className="mx-auto mt-md max-w-[680px] text-base leading-relaxed text-on-surface-variant sm:text-xl">
            TrackQA makes it easy for teams to report bugs with clear reproduction steps, assign them to developers, and test fixes before they reach your users.
          </p>

          {/* Large Action Buttons */}
          <div className="mt-lg flex flex-wrap items-center justify-center gap-md">
            <Link
              to="/signup"
              className="inline-flex items-center gap-sm rounded-lg bg-primary px-8 py-4 text-base font-bold text-on-primary hover:bg-primary-container transition-colors shadow-sm sm:text-lg"
            >
              <span>Get Started Free</span>
              <ArrowRight size={20} />
            </Link>
            <a
              href="#app-simulation"
              className="inline-flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-8 py-4 text-base font-semibold text-on-surface hover:bg-surface-container transition-colors sm:text-lg"
            >
              <span>Try In-App Simulation</span>
              <ChevronRight size={20} />
            </a>
          </div>

          {/* Simple, relatable highlights */}
          <div className="mt-xl flex flex-wrap items-center justify-center gap-x-lg gap-y-sm text-sm font-medium text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <Check className="text-emerald-600" size={16} />
              <span>Free for teams</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="text-emerald-600" size={16} />
              <span>Instant setup with 6-digit code</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="text-emerald-600" size={16} />
              <span>Clear Pass / Fail test records</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="text-emerald-600" size={16} />
              <span>Real-time updates</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. REALISTIC IN-APP SIMULATION */}
      <section id="app-simulation" className="border-b border-outline-variant bg-surface-container-low px-md py-xl sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-lg text-center">
            <h2 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              Live In-App Simulation
            </h2>
            <p className="mx-auto mt-xs max-w-[640px] text-base text-on-surface-variant">
              This is the actual TrackQA interface. Test it live: click <strong>Pass QA Verification</strong> or <strong>Mark QA Failed</strong> to see how the workbench operates.
            </p>
          </div>

          {/* App Window Frame */}
          <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-md">
            {/* Window Top Chrome */}
            <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container px-md py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <span className="ml-3 font-mono text-xs text-on-surface-variant">
                  trackqa.app / Acme Project / TQA-42
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
                title="Reset simulation to initial state"
              >
                <RotateCcw size={12} />
                <span>Reset Simulation</span>
              </button>
            </div>

            {/* App Body (Mini-Sidebar + Workbench Canvas) */}
            <div className="flex min-h-[580px]">
              {/* Mini App Sidebar */}
              <div className="hidden w-52 border-r border-outline-variant bg-surface p-sm sm:flex flex-col justify-between">
                <div>
                  <div className="mb-sm px-2 py-1 text-xs font-bold uppercase tracking-wider text-outline">
                    Acme Mobile App
                  </div>
                  <nav className="space-y-0.5 text-xs font-medium">
                    <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-on-surface-variant hover:bg-surface-container">
                      <LayoutDashboard size={14} />
                      <span>Dashboard</span>
                    </div>
                    <div className="flex items-center gap-2 rounded bg-primary-fixed/40 px-2.5 py-1.5 font-bold text-primary">
                      <Bug size={14} />
                      <span>Backlog</span>
                    </div>
                    <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-on-surface-variant hover:bg-surface-container">
                      <Inbox size={14} />
                      <span>My Tasks</span>
                    </div>
                    <div className="flex items-center gap-2 rounded px-2.5 py-1.5 text-on-surface-variant hover:bg-surface-container">
                      <Users size={14} />
                      <span>Team Members</span>
                    </div>
                  </nav>
                </div>
                <div className="border-t border-outline-variant pt-2 px-2 text-xs text-outline">
                  Logged in as <strong className="text-on-surface">Sarah (QA)</strong>
                </div>
              </div>

              {/* Main Issue Canvas (Matching IssueDetail.tsx) */}
              <div className="flex-1 p-md sm:p-lg bg-surface-container-lowest">
                {/* Breadcrumb */}
                <div className="mb-xs flex items-center gap-1 text-xs text-on-surface-variant">
                  <span>Backlog</span>
                  <ChevronRight size={12} className="text-outline" />
                  <span className="font-mono font-bold text-on-surface">TQA-42</span>
                </div>

                {/* Issue Header Banner */}
                <div className="mb-md flex flex-wrap items-center justify-between gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-sm">
                  <div className="flex flex-wrap items-center gap-xs">
                    <span className="rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xs font-bold text-on-surface">
                      TQA-42
                    </span>
                    {/* Dynamic Status Badge */}
                    {simStatus === 'FOR_TESTING' && (
                      <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                        For Testing
                      </span>
                    )}
                    {simStatus === 'PASSED' && (
                      <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        QA Passed
                      </span>
                    )}
                    {simStatus === 'FAILED' && (
                      <span className="inline-flex items-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        QA Failed
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      <ChevronUp size={12} className="text-amber-600" />
                      High
                    </span>
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    Assignee: <strong className="text-on-surface">David (Dev)</strong>
                  </div>
                </div>

                <h3 className="text-lg font-bold text-on-surface sm:text-xl">
                  Sign In button does not click on mobile
                </h3>

                {/* Workflow Stepper Bar (Exact match to IssueDetail.tsx) */}
                <div className="mt-md mb-md overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
                  <div className="grid grid-cols-5 divide-x divide-outline-variant text-center">
                    {/* Step 01 */}
                    <div className="p-2 bg-surface-container-low">
                      <div className="flex items-center justify-between text-xs font-mono text-outline">
                        <span>01</span>
                        <Check size={12} className="text-emerald-600" />
                      </div>
                      <p className="text-xs font-bold text-on-surface mt-0.5">Open</p>
                    </div>

                    {/* Step 02 */}
                    <div className="p-2 bg-surface-container-low">
                      <div className="flex items-center justify-between text-xs font-mono text-outline">
                        <span>02</span>
                        <Check size={12} className="text-emerald-600" />
                      </div>
                      <p className="text-xs font-bold text-on-surface mt-0.5">In Dev</p>
                    </div>

                    {/* Step 03: For Testing */}
                    <div
                      className={`p-2 transition-colors ${
                        simStatus === 'FAILED'
                          ? 'bg-rose-500/10 text-rose-800'
                          : simStatus === 'FOR_TESTING'
                            ? 'bg-amber-500/10 text-amber-800'
                            : 'bg-surface-container-low text-on-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-outline">03</span>
                        {simStatus === 'PASSED' && <Check size={12} className="text-emerald-600" />}
                        {simStatus === 'FAILED' && <XCircle size={12} className="text-rose-600" />}
                        {simStatus === 'FOR_TESTING' && <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />}
                      </div>
                      <p className="text-xs font-bold mt-0.5">
                        {simStatus === 'FAILED' ? 'QA Failed' : 'For QA'}
                      </p>
                    </div>

                    {/* Step 04: Verified */}
                    <div
                      className={`p-2 transition-colors ${
                        simStatus === 'PASSED'
                          ? 'bg-emerald-500/10 text-emerald-800'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono text-outline">
                        <span>04</span>
                        {simStatus === 'PASSED' && <CheckCircle2 size={12} className="text-emerald-600" />}
                      </div>
                      <p className="text-xs font-bold mt-0.5">Verified</p>
                    </div>

                    {/* Step 05: Closed */}
                    <div className="p-2 text-on-surface-variant opacity-60">
                      <div className="flex items-center justify-between text-xs font-mono text-outline">
                        <span>05</span>
                      </div>
                      <p className="text-xs font-bold mt-0.5">Closed</p>
                    </div>
                  </div>
                </div>

                {/* 2-Column App Layout (Workbench Left, Metadata Right) */}
                <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
                  {/* Left 2 Cols: The QA Verification Bench + Repro Details */}
                  <div className="space-y-md lg:col-span-2">
                    {/* QA Verification Bench Card */}
                    <div className="rounded-lg border-2 border-primary/40 bg-surface-container-lowest p-md">
                      <div className="mb-sm flex items-center justify-between border-b border-outline-variant pb-2">
                        <div className="flex items-center gap-1.5">
                          <FlaskConical size={16} className="text-primary" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                            QA Verification Bench
                          </h4>
                        </div>
                        {simStatus === 'FOR_TESTING' && (
                          <span className="rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 font-mono text-xs font-semibold text-amber-800">
                            AWAITING QA VERIFICATION
                          </span>
                        )}
                        {simStatus === 'PASSED' && (
                          <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800">
                            QA VERIFIED PASSED
                          </span>
                        )}
                        {simStatus === 'FAILED' && (
                          <span className="rounded bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 font-mono text-xs font-semibold text-rose-800">
                            QA VERIFICATION FAILED
                          </span>
                        )}
                      </div>

                      {simStatus === 'FOR_TESTING' ? (
                        <div className="space-y-sm">
                          <p className="text-xs text-on-surface-variant">
                            Execute reproduction steps against David's fix on mobile Safari. Record your verification outcome:
                          </p>

                          <div>
                            <label className="mb-1 block text-xs font-semibold text-on-surface">
                              Verification Notes & Findings
                            </label>
                            <textarea
                              rows={2}
                              value={simNote}
                              onChange={(e) => setSimNote(e.target.value)}
                              placeholder="e.g. Tested on iPhone 15: Fix confirmed. Button taps smoothly."
                              className="w-full rounded border border-outline-variant bg-surface-container-low p-2 text-xs text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                            />
                          </div>

                          {/* Action Buttons (Exact match to the app) */}
                          <div className="flex flex-wrap items-center gap-sm pt-1">
                            <button
                              type="button"
                              onClick={handlePass}
                              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-800 transition-colors shadow-xs"
                            >
                              <Check size={14} />
                              <span>Pass QA Verification</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleFail}
                              className="inline-flex items-center gap-1.5 rounded-md bg-rose-700 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-800 transition-colors shadow-xs"
                            >
                              <XCircle size={14} />
                              <span>Mark QA Failed</span>
                            </button>
                          </div>
                        </div>
                      ) : simStatus === 'PASSED' ? (
                        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-sm text-xs">
                          <div className="flex items-center justify-between font-bold text-emerald-900">
                            <span className="flex items-center gap-1">
                              <CheckCircle2 size={14} />
                              <span>VERDICT: PASSED</span>
                            </span>
                            <span className="font-mono text-xs text-emerald-800">Verified by Sarah (QA)</span>
                          </div>
                          <p className="mt-1.5 text-emerald-950 font-sans">
                            {simNote}
                          </p>
                          <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-1.5">
                            <span className="text-emerald-800">✓ Ready to release to production</span>
                            <button
                              type="button"
                              onClick={handleReset}
                              className="font-bold underline text-emerald-900 hover:text-emerald-700"
                            >
                              Test again
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-sm text-xs">
                          <div className="flex items-center justify-between font-bold text-rose-900">
                            <span className="flex items-center gap-1">
                              <XCircle size={14} />
                              <span>VERDICT: FAILED</span>
                            </span>
                            <span className="font-mono text-xs text-rose-800">Rejected by Sarah (QA)</span>
                          </div>
                          <p className="mt-1.5 text-rose-950 font-sans">
                            {simNote}
                          </p>
                          <div className="mt-2 flex items-center justify-between border-t border-rose-200 pt-1.5">
                            <span className="text-rose-800">✕ Returned to David (Dev) queue</span>
                            <button
                              type="button"
                              onClick={handleReset}
                              className="font-bold underline text-rose-900 hover:text-rose-700"
                            >
                              Test again
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Reproduction Manifest Card */}
                    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md text-xs">
                      <h4 className="font-bold uppercase tracking-wider text-outline mb-2">
                        Reproduction Steps & Details
                      </h4>
                      <ol className="list-decimal space-y-1 pl-4 text-on-surface">
                        <li>Open the login page on a mobile browser.</li>
                        <li>Enter email and password.</li>
                        <li>Tap the blue "Sign In" button.</li>
                      </ol>

                      <div className="mt-sm grid grid-cols-2 gap-sm rounded border border-outline-variant bg-surface-container-low p-2">
                        <div>
                          <span className="text-outline font-semibold">Expected:</span>
                          <p className="text-emerald-700 font-medium mt-0.5">Logs in to dashboard immediately</p>
                        </div>
                        <div>
                          <span className="text-outline font-semibold">Actual:</span>
                          <p className="text-rose-700 font-medium mt-0.5">Button spins forever, nothing opens</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Metadata Sidebar (Matching IssueDetail.tsx) */}
                  <div className="space-y-sm">
                    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-sm text-xs">
                      <h4 className="font-bold uppercase tracking-wider text-outline mb-2">
                        Issue Properties
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Status:</span>
                          <span className="font-semibold text-on-surface">
                            {simStatus === 'FOR_TESTING' ? 'For Testing' : simStatus === 'PASSED' ? 'QA Passed' : 'QA Failed'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Priority:</span>
                          <span className="font-semibold text-amber-700">High</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Assignee:</span>
                          <span className="font-semibold text-on-surface">David (Developer)</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Reporter:</span>
                          <span className="font-semibold text-on-surface">Sarah (QA Lead)</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-sm text-xs">
                      <h4 className="font-bold uppercase tracking-wider text-outline mb-2">
                        Environment Specs
                      </h4>
                      <div className="space-y-1.5 text-on-surface">
                        <div>
                          <span className="text-outline">Device:</span>{' '}
                          <span className="font-mono font-medium">Apple iPhone 15</span>
                        </div>
                        <div>
                          <span className="text-outline">Browser:</span>{' '}
                          <span className="font-mono font-medium">Mobile Safari (iOS 17)</span>
                        </div>
                        <div>
                          <span className="text-outline">App Version:</span>{' '}
                          <span className="font-mono font-medium">v2.4.1 (Staging)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW IT WORKS (SIMPLE 4 STEPS) */}
      <section id="how-it-works" className="border-b border-outline-variant bg-surface px-md py-xl sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[1040px]">
          <div className="mb-lg text-center">
            <h2 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              How It Works
            </h2>
            <p className="mx-auto mt-xs max-w-[640px] text-base text-on-surface-variant">
              From finding a bug to making sure it is truly fixed.
            </p>
          </div>

          {/* 4 Steps Grid */}
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <div
                key={step.stepNumber}
                onClick={() => setActiveStep(index)}
                className={`flex flex-col justify-between rounded-xl border p-md transition-all cursor-pointer ${
                  activeStep === index
                    ? 'border-primary bg-surface-container-lowest shadow-sm'
                    : 'border-outline-variant bg-surface-container-lowest hover:border-outline'
                }`}
              >
                <div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-bold text-sm text-on-primary">
                    {step.stepNumber}
                  </div>
                  <h3 className="mt-sm text-base font-bold text-on-surface">
                    {step.title}
                  </h3>
                  <p className="mt-xs text-sm leading-relaxed text-on-surface-variant">
                    {step.description}
                  </p>
                </div>
                <div className="mt-md border-t border-outline-variant pt-xs text-xs font-semibold text-primary">
                  {step.highlight}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. THE 4 MAIN FEATURES (LAYMAN'S TERMS) */}
      <section id="features" className="border-b border-outline-variant bg-surface-container-low px-md py-xl sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[1040px]">
          <div className="mb-lg text-center">
            <h2 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              Everything your team needs to track and fix bugs
            </h2>
            <p className="mx-auto mt-xs max-w-[640px] text-base text-on-surface-variant">
              Simple tools that make defect tracking fast, organized, and reliable.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-md md:grid-cols-2">
            {/* Feature 1 */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <ListOrdered size={22} />
                </div>
                <h3 className="text-lg font-bold text-on-surface">
                  Clear steps to recreate every bug
                </h3>
              </div>
              <p className="mt-sm text-sm leading-relaxed text-on-surface-variant">
                Every ticket includes dedicated fields for the device, browser, and step-by-step instructions. Developers will never have to ask "how do I reproduce this?" again.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <ShieldCheck size={22} />
                </div>
                <h3 className="text-lg font-bold text-on-surface">
                  Dedicated testing stage
                </h3>
              </div>
              <p className="mt-sm text-sm leading-relaxed text-on-surface-variant">
                When developers finish a fix, it goes into a dedicated "For Testing" list. Testers check the fix on real devices before anything gets marked as completed.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <FileCheck size={22} />
                </div>
                <h3 className="text-lg font-bold text-on-surface">
                  Clear Pass or Fail results
                </h3>
              </div>
              <p className="mt-sm text-sm leading-relaxed text-on-surface-variant">
                Testers record whether a fix Passed or Failed in one click, along with notes and screenshots. The whole team always knows the current status of every fix.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-700">
                  <Users size={22} />
                </div>
                <h3 className="text-lg font-bold text-on-surface">
                  Instant team invites
                </h3>
              </div>
              <p className="mt-sm text-sm leading-relaxed text-on-surface-variant">
                No complicated seat setups or licensing headaches. Generate a simple 6-digit invite code and share it with your team so everyone can collaborate right away.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. COMPARISON SECTION (RESPECTFUL & INFORMATIVE) */}
      <section id="comparison" className="border-b border-outline-variant bg-surface px-md py-xl sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[940px]">
          <div className="mb-lg text-center">
            <h2 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              Built specifically for bug testing
            </h2>
            <p className="mx-auto mt-xs max-w-[640px] text-base text-on-surface-variant">
              General task managers are great for general tasks. TrackQA is designed around how testers and developers actually find, reproduce, and confirm bug fixes.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container text-xs font-bold uppercase text-on-surface-variant">
                  <th className="px-md py-sm w-1/4">Feature</th>
                  <th className="px-md py-sm w-3/8 text-on-surface-variant">General Task Trackers</th>
                  <th className="px-md py-sm w-3/8 text-primary bg-primary-fixed/20">TrackQA Workbench</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-sm">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-md py-sm font-semibold text-on-surface">
                      {row.feature}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {row.general}
                    </td>
                    <td className="px-md py-sm font-medium text-on-surface bg-primary-fixed/10">
                      {row.trackqa}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 7. FINAL CALL TO ACTION (WIDE, PROPERLY WRAPPED, PROMINENT BUTTONS) */}
      <section className="border-b border-outline-variant bg-primary px-md py-xl text-center text-on-primary sm:px-lg sm:py-2xl">
        <div className="mx-auto max-w-[700px]">
          <h2 className="text-3xl font-extrabold tracking-tight text-on-primary sm:text-4xl">
            Start tracking and verifying bugs today.
          </h2>
          <p className="mx-auto mt-sm max-w-[560px] text-base leading-relaxed text-on-primary-container sm:text-lg">
            Create a project in seconds, invite your developers and testers with a simple code, and make sure every bug is genuinely fixed before release.
          </p>
          <div className="mt-lg flex flex-wrap items-center justify-center gap-md">
            <Link
              to="/signup"
              className="inline-flex items-center gap-sm rounded-lg bg-surface-container-lowest px-8 py-4 text-base font-bold text-primary hover:bg-surface-container transition-colors shadow-sm sm:text-lg"
            >
              <span>Create Free Account</span>
              <ArrowRight size={20} />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-sm rounded-lg border border-on-primary/30 px-8 py-4 text-base font-semibold text-on-primary hover:bg-on-primary/10 transition-colors sm:text-lg"
            >
              <span>Sign In to Your Project</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="bg-surface-container-lowest px-md py-lg sm:px-lg sm:py-xl">
        <div className="mx-auto max-w-[1040px]">
          <div className="flex flex-wrap items-center justify-between gap-md border-b border-outline-variant pb-md">
            <div className="flex items-center gap-sm">
              <span className="text-xl font-bold text-on-surface">TrackQA</span>
              <span className="text-sm text-on-surface-variant">
                The bug tracker built for testing.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-md text-sm text-on-surface-variant">
              <a href="#app-simulation" className="hover:text-on-surface transition-colors">
                App Simulation
              </a>
              <a href="#how-it-works" className="hover:text-on-surface transition-colors">
                How It Works
              </a>
              <a href="#features" className="hover:text-on-surface transition-colors">
                Features
              </a>
              <a href="#comparison" className="hover:text-on-surface transition-colors">
                Why TrackQA
              </a>
              <Link to="/login" className="hover:text-on-surface transition-colors">
                Sign In
              </Link>
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Create Account
              </Link>
            </div>
          </div>

          <div className="mt-md flex flex-wrap items-center justify-between gap-sm text-xs text-outline">
            <p>© {new Date().getFullYear()} TrackQA. All rights reserved.</p>
            <p>Built for developers and QA teams.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Landing

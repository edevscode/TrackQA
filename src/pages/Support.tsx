import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  HelpCircle,
  Keyboard,
  Search,
  Send,
  ShieldAlert,
  Terminal,
  Users,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'

interface FAQItem {
  id: string
  question: string
  answer: string
  category: 'general' | 'workflow' | 'roles' | 'sync'
}

const FAQS: FAQItem[] = [
  {
    id: 'roles-diff',
    category: 'roles',
    question: 'What are the permission differences between project roles?',
    answer:
      'TrackQA provides 4 role tiers: QA Lead (full administrative rights, delete/archive permissions), QA Engineer (log issues, execute test verifications, assign issues), Developer (claim issues, move to In Dev, submit builds for QA testing), and Viewer (read-only audit access).',
  },
  {
    id: 'key-prefix',
    category: 'workflow',
    question: 'Why is the project key prefix permanent after creation?',
    answer:
      'Project keys (e.g. [PR-101]) are permanently bound to all database records, verification history, and external git commit references to ensure defect audit trails never break.',
  },
  {
    id: 'for-testing',
    category: 'workflow',
    question: 'What happens when an issue moves into "For Testing"?',
    answer:
      'When an issue is moved to "For Testing", it enters the QA Test Bench queue. QA engineers are notified to execute reproduction tests and attach passing/failing test verdicts before closing the defect.',
  },
  {
    id: 'realtime-sync',
    category: 'sync',
    question: 'How does real-time team synchronization work?',
    answer:
      'TrackQA uses Supabase WebSockets to stream database mutations instantly. When any teammate creates an issue, changes a status, or posts a comment, your view updates automatically without requiring a browser reload.',
  },
  {
    id: 'invite-members',
    category: 'general',
    question: 'How do I invite teammates to collaborate?',
    answer:
      'Go to the Members page (/members) and click "Invite Member". Enter your teammate’s email and assign their role. If they have an existing account, they are instantly added; otherwise, an email invitation is generated.',
  },
  {
    id: 'archive-projects',
    category: 'general',
    question: 'How do I archive or restore completed repositories?',
    answer:
      'Project Admins can archive a project from Project Settings. Archived repositories enter a read-only state to prevent accidental changes, but can be restored anytime from the Archived Projects screen.',
  },
]

const GUIDES = [
  {
    icon: Zap,
    title: 'Quick Start & Workflows',
    description: 'Master the 4-stage defect lifecycle from triage to completed verification.',
    tag: 'Guide',
    href: '/issues',
  },
  {
    icon: Users,
    title: 'Team Roles & Access',
    description: 'Configure QA Lead, Developer, and Engineer permissions effectively.',
    tag: 'Permissions',
    href: '/members',
  },
  {
    icon: Terminal,
    title: 'Defect Blueprint Standard',
    description: 'Best practices for writing deterministic reproduction steps and triage severity.',
    tag: 'QA Standard',
    href: '/issues/new',
  },
  {
    icon: BookOpen,
    title: 'Project Settings & Repo Key',
    description: 'Project identifier conventions, notification thresholds, and archiving.',
    tag: 'Settings',
    href: '/project-settings',
  },
]

const KEYBOARD_SHORTCUTS = [
  { keys: ['⌘ / Ctrl', 'K'], label: 'Global quick search' },
  { keys: ['C'], label: 'Create new issue' },
  { keys: ['R'], label: 'Trigger project sync' },
  { keys: ['Esc'], label: 'Close modals & drawers' },
]

export default function Support() {
  const { user, profile } = useAuth()
  const { currentProject } = useProject()

  const [searchQuery, setSearchQuery] = useState('')
  const [openFaq, setOpenFaq] = useState<string | null>('roles-diff')
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'general' | 'workflow' | 'roles' | 'sync'>('all')

  // Contact Form State
  const [ticketCategory, setTicketCategory] = useState('bug_report')
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketMessage, setTicketMessage] = useState('')
  const [ticketUrgency, setTicketUrgency] = useState<'normal' | 'urgent'>('normal')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Copy Diagnostics State
  const [copiedDiag, setCopiedDiag] = useState(false)

  const filteredFaqs = useMemo(() => {
    return FAQS.filter((faq) => {
      const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory
      const query = searchQuery.trim().toLowerCase()
      if (!query) return matchesCategory
      const matchesText =
        faq.question.toLowerCase().includes(query) || faq.answer.toLowerCase().includes(query)
      return matchesCategory && matchesText
    })
  }, [searchQuery, selectedCategory])

  const handleCopyDiagnostics = async () => {
    const diag = [
      '### TrackQA Environment Diagnostic',
      `- **Timestamp:** ${new Date().toISOString()}`,
      `- **User ID:** \`${user?.id ?? 'N/A'}\``,
      `- **Project ID:** \`${currentProject?.id ?? 'N/A'}\``,
      `- **Project Key:** \`${currentProject?.key ?? 'N/A'}\``,
      `- **Browser:** ${navigator.userAgent}`,
      `- **Screen Resolution:** ${window.innerWidth}x${window.innerHeight}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(diag)
      setCopiedDiag(true)
      setTimeout(() => setCopiedDiag(false), 2500)
    } catch {
      // Fallback if clipboard API unavailable
    }
  }

  const handleSubmitTicket = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticketSubject.trim() || !ticketMessage.trim()) return

    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      setSubmitted(true)
      setTicketSubject('')
      setTicketMessage('')
    }, 600)
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Support Header Strip */}
          <div className="mb-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-lg">
            <div className="flex flex-col gap-md lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-xs">
                  <span className="rounded bg-primary-fixed px-xs py-0.5 font-mono text-code-xs font-bold text-on-primary-fixed uppercase tracking-wider">
                    Help Center
                  </span>
                  <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                    Support &amp; Documentation
                  </h1>
                </div>
                <p className="mt-xs text-body-md text-on-surface-variant">
                  Guides, FAQs, keyboard shortcuts, and direct engineering support for your QA team.
                </p>
              </div>

              {/* Live Status Pill */}
              <div className="flex items-center gap-sm rounded-md border border-emerald-500/30 bg-emerald-500/10 px-md py-sm text-body-md font-medium text-emerald-800 dark:text-emerald-300">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                </span>
                <span>All Systems Operational</span>
              </div>
            </div>

            {/* Quick Search Bar */}
            <div className="mt-lg relative">
              <Search
                size={18}
                className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search troubleshooting guides, FAQs, or workflows..."
                className="w-full rounded-md border border-outline-variant bg-surface-container-low py-sm pl-xl pr-md text-body-lg text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-lowest focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-md top-1/2 -translate-y-1/2 text-body-md font-medium text-on-surface-variant hover:text-on-surface"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Quick Topics Grid */}
          <div className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {GUIDES.map(({ icon: Icon, title, description, tag, href }) => (
              <Link
                key={title}
                to={href}
                className="group flex flex-col justify-between rounded-lg border border-outline-variant bg-surface-container-lowest p-md transition-all duration-200 hover:border-outline hover:shadow-sm"
              >
                <div>
                  <div className="mb-sm flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-fixed text-primary transition-transform duration-200 group-hover:scale-105">
                      <Icon size={18} />
                    </div>
                    <span className="rounded bg-surface-container px-xs py-0.5 text-label-md font-medium text-on-surface-variant">
                      {tag}
                    </span>
                  </div>
                  <h3 className="text-body-lg font-semibold text-on-surface group-hover:text-primary transition-colors">
                    {title}
                  </h3>
                  <p className="mt-xs text-body-md text-on-surface-variant line-clamp-2">
                    {description}
                  </p>
                </div>
                <div className="mt-md flex items-center gap-xs text-body-md font-semibold text-primary">
                  <span>Explore</span>
                  <ExternalLink size={14} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
            {/* Left Column: FAQ Accordion (lg:col-span-7) */}
            <div className="flex flex-col gap-md lg:col-span-7">
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:p-lg">
                <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between border-b border-outline-variant pb-md">
                  <div>
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      Frequently Asked Questions
                    </h2>
                    <p className="text-body-md text-on-surface-variant">
                      Answers to commonly asked questions about TrackQA operations.
                    </p>
                  </div>

                  {/* Category Pills */}
                  <div className="flex flex-wrap gap-xs">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'workflow', label: 'Workflows' },
                        { id: 'roles', label: 'Roles' },
                        { id: 'sync', label: 'Realtime' },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSelectedCategory(id)}
                        className={`rounded-md px-sm py-xs text-label-md font-medium transition-colors ${
                          selectedCategory === id
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredFaqs.length === 0 ? (
                  <div className="py-xl text-center">
                    <HelpCircle size={32} className="mx-auto mb-sm text-outline" />
                    <p className="text-body-lg font-medium text-on-surface">No matching FAQs found</p>
                    <p className="text-body-md text-on-surface-variant">
                      Try searching with different keywords or submit a question below.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-xs">
                    {filteredFaqs.map((faq) => {
                      const isOpen = openFaq === faq.id
                      return (
                        <div
                          key={faq.id}
                          className="overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => setOpenFaq(isOpen ? null : faq.id)}
                            className="flex w-full items-center justify-between p-md text-left text-body-lg font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
                          >
                            <span>{faq.question}</span>
                            <ChevronDown
                              size={18}
                              className={`shrink-0 text-on-surface-variant transition-transform duration-200 ${
                                isOpen ? 'rotate-180 text-primary' : ''
                              }`}
                            />
                          </button>
                          {isOpen && (
                            <div className="border-t border-outline-variant bg-surface-container-low p-md text-body-md text-on-surface-variant leading-relaxed">
                              {faq.answer}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Keyboard Shortcuts Reference */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:p-lg">
                <div className="mb-md flex items-center gap-xs">
                  <Keyboard size={18} className="text-primary" />
                  <h3 className="text-headline-md font-semibold text-on-surface">
                    Keyboard Shortcuts
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                  {KEYBOARD_SHORTCUTS.map(({ keys, label }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-md border border-outline-variant bg-surface-container-low px-md py-sm"
                    >
                      <span className="text-body-md text-on-surface font-medium">{label}</span>
                      <div className="flex items-center gap-1">
                        {keys.map((k) => (
                          <kbd
                            key={k}
                            className="rounded border border-outline-variant bg-surface-container-lowest px-1.5 py-0.5 font-mono text-code-xs font-semibold text-on-surface shadow-xs"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Contact Ticket Form & Diagnostics (lg:col-span-5) */}
            <div className="flex flex-col gap-md lg:col-span-5">
              {/* Contact Support Ticket */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:p-lg">
                <div className="mb-md border-b border-outline-variant pb-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-headline-md font-semibold text-on-surface">
                      Contact Support
                    </h2>
                    <span className="rounded bg-primary-fixed/60 px-xs py-0.5 text-label-md font-semibold text-on-primary-fixed">
                      SLA: &lt; 2h
                    </span>
                  </div>
                  <p className="mt-xs text-body-md text-on-surface-variant">
                    Submit a ticket directly to the engineering team.
                  </p>
                </div>

                {submitted ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-lg text-center">
                    <div className="mx-auto mb-sm flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-raised">
                      <Check size={24} />
                    </div>
                    <h3 className="text-headline-md font-bold text-emerald-950 dark:text-emerald-100">
                      Ticket Dispatched
                    </h3>
                    <p className="mt-xs text-body-md text-emerald-800 dark:text-emerald-300">
                      Your inquiry has been received. Our team will review and reply to{' '}
                      <strong>{user?.email}</strong> shortly.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSubmitted(false)}
                      className="mt-md rounded-md bg-emerald-700 px-md py-sm text-body-md font-semibold text-white hover:bg-emerald-800 transition-colors"
                    >
                      Send Another Message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmitTicket} className="flex flex-col gap-md">
                    <div>
                      <label
                        htmlFor="ticket-type"
                        className="mb-xs block text-label-md font-semibold text-on-surface"
                      >
                        Inquiry Category
                      </label>
                      <select
                        id="ticket-type"
                        value={ticketCategory}
                        onChange={(e) => setTicketCategory(e.target.value)}
                        className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface focus:border-primary focus:outline-none"
                      >
                        <option value="bug_report">🐛 Bug / Defect Report</option>
                        <option value="feature_request">💡 Feature Request</option>
                        <option value="account_access">🔐 Account &amp; Permissions</option>
                        <option value="general_question">💬 General Question</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="ticket-subject"
                        className="mb-xs block text-label-md font-semibold text-on-surface"
                      >
                        Subject <span className="text-error">*</span>
                      </label>
                      <input
                        id="ticket-subject"
                        type="text"
                        required
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder="Brief summary of your question or issue"
                        className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface focus:border-primary focus:bg-surface-container-lowest focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="ticket-message"
                        className="mb-xs block text-label-md font-semibold text-on-surface"
                      >
                        Message / Details <span className="text-error">*</span>
                      </label>
                      <textarea
                        id="ticket-message"
                        required
                        rows={4}
                        value={ticketMessage}
                        onChange={(e) => setTicketMessage(e.target.value)}
                        placeholder="Describe the issue, steps to reproduce, or questions..."
                        className="w-full resize-y rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface focus:border-primary focus:bg-surface-container-lowest focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-xs">
                      <div className="flex items-center gap-xs">
                        <button
                          type="button"
                          onClick={() =>
                            setTicketUrgency(ticketUrgency === 'urgent' ? 'normal' : 'urgent')
                          }
                          className={`flex items-center gap-xs rounded-md border px-sm py-xs text-label-md font-medium transition-colors ${
                            ticketUrgency === 'urgent'
                              ? 'border-error/40 bg-error-container text-on-error-container'
                              : 'border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-outline'
                          }`}
                        >
                          <ShieldAlert size={14} />
                          <span>{ticketUrgency === 'urgent' ? 'Urgent Priority' : 'Standard'}</span>
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                      >
                        <Send size={16} />
                        <span>{submitting ? 'Sending…' : 'Submit Ticket'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Environment Diagnostics Widget */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md lg:p-lg">
                <div className="mb-sm flex items-center justify-between">
                  <div className="flex items-center gap-xs">
                    <Terminal size={18} className="text-primary" />
                    <h3 className="text-headline-md font-semibold text-on-surface">
                      System Diagnostics
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyDiagnostics}
                    className="inline-flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors"
                  >
                    {copiedDiag ? (
                      <>
                        <Check size={14} className="text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        <span>Copy Diagnostic</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="mb-md text-body-md text-on-surface-variant">
                  Attach this environment snapshot when reporting technical bugs to engineering.
                </p>

                <div className="flex flex-col gap-xs rounded-md border border-outline-variant bg-surface-container-low p-sm font-mono text-code-xs text-on-surface-variant">
                  <div className="flex justify-between">
                    <span>Project:</span>
                    <strong className="text-on-surface">{currentProject?.name ?? 'None'} [{currentProject?.key ?? 'QA'}]</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>User:</span>
                    <strong className="text-on-surface truncate max-w-[200px]">{profile?.full_name ?? user?.email ?? 'N/A'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Realtime:</span>
                    <strong className="text-emerald-600 font-semibold">Active &amp; Connected</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

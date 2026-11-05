import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bot, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react'
import TrackQALogo from '../components/TrackQALogo'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { mcpSetup } from '../lib/mcpOnboarding'

interface EligibleProject {
  id: string
  name: string
  mcp_enabled: boolean
}

export default function AuthorizeAgent() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const portParam = searchParams.get('port')
  const stateParam = searchParams.get('state')
  const projectParam = searchParams.get('project')

  const port = portParam ? parseInt(portParam, 10) : null
  const isValidPort = port !== null && Number.isInteger(port) && port >= 1024 && port <= 65535
  const isValidState = Boolean(stateParam && /^[0-9a-fA-F]{16,128}$/.test(stateParam))

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<EligibleProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [authorizing, setAuthorizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    if (!user) return
    async function loadProjects() {
      try {
        setLoading(true)
        const { data, error: queryError } = await supabase
          .from('project_members')
          .select('project_id, role, projects(id, name, mcp_enabled, archived)')
          .eq('user_id', user!.id)
          .eq('role', 'OWNER')

        if (queryError) throw queryError

        const eligible: EligibleProject[] = []
        for (const row of data || []) {
          // Supabase join typing can be single object or array
          const proj = Array.isArray(row.projects) ? row.projects[0] : row.projects
          if (proj && !proj.archived) {
            eligible.push({
              id: proj.id,
              name: proj.name,
              mcp_enabled: proj.mcp_enabled,
            })
          }
        }

        setProjects(eligible)
        if (eligible.length > 0) {
          const matched = projectParam && eligible.find(p => p.id === projectParam)
          setSelectedProjectId(matched ? matched.id : eligible[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your projects.')
      } finally {
        setLoading(false)
      }
    }
    void loadProjects()
  }, [user, projectParam])

  const selectedProject = projects.find(p => p.id === selectedProjectId)

  function handleCancel() {
    if (isValidPort && isValidState) {
      window.location.replace(`http://127.0.0.1:${port}/callback?state=${encodeURIComponent(stateParam!)}&error=cancelled`)
    } else {
      navigate('/dashboard')
    }
  }

  async function handleAuthorize() {
    if (!selectedProject || !isValidPort || !isValidState || !user) return

    setAuthorizing(true)
    setError(null)

    try {
      // 1. Ensure MCP is enabled for the selected project
      if (!selectedProject.mcp_enabled) {
        const { error: enableError } = await supabase
          .from('projects')
          .update({ mcp_enabled: true })
          .eq('id', selectedProject.id)
        if (enableError) throw enableError
      }

      // 2. Issue connection token via existing secure RPC
      const { data: tokenData, error: tokenError } = await supabase.rpc(
        'issue_mcp_connection_token',
        {
          p_project_id: selectedProject.id,
          p_user_id: user.id,
          p_client_label: 'Auto-Setup',
        }
      )

      if (tokenError) throw tokenError

      const row = Array.isArray(tokenData) ? tokenData[0] : tokenData
      if (!row || !row.access_token) {
        throw new Error('No access token returned from authorization.')
      }

      const { endpoint } = mcpSetup(import.meta.env.VITE_SUPABASE_URL, selectedProject.id)
      setAuthorized(true)

      // 3. Deliver back to local loopback CLI
      const callbackUrl = `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(
        stateParam!
      )}&token=${encodeURIComponent(row.access_token)}&project_id=${encodeURIComponent(
        selectedProject.id
      )}&project_name=${encodeURIComponent(selectedProject.name)}&endpoint=${encodeURIComponent(
        endpoint
      )}`

      setTimeout(() => {
        window.location.replace(callbackUrl)
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize AI agent.')
      setAuthorizing(false)
    }
  }

  if (!isValidPort || !isValidState) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-lg sm:py-xl">
        <div className="w-full max-w-[480px]">
          <div className="mb-lg flex justify-center">
            <TrackQALogo size="md" />
          </div>
          <div className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-sm sm:p-xl">
            <div className="flex items-center gap-sm text-error">
              <AlertCircle className="h-6 w-6 shrink-0" />
              <h2 className="text-title-md font-semibold text-on-surface">Invalid Setup Request</h2>
            </div>
            <p className="mt-md text-body-sm text-on-surface-variant">
              This setup session is missing a valid loopback port or state token. Please run{' '}
              <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-code-xs font-semibold">
                npx trackqa setup
              </code>{' '}
              from your terminal.
            </p>
            <div className="mt-lg flex justify-end">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="rounded-lg bg-surface-container-high px-md py-sm text-sm font-semibold text-on-surface hover:bg-surface-container-highest transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-md py-lg sm:py-xl">
      <div className="w-full max-w-[480px]">
        {/* TrackQA Official Branding */}
        <div className="mb-lg flex justify-center">
          <TrackQALogo size="md" />
        </div>

        {/* Main Authorization Card */}
        <div className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-sm sm:p-xl">
          <div className="flex items-center gap-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-on-surface sm:text-2xl">
                Connect AI Agent
              </h1>
              <p className="text-body-xs text-on-surface-variant">
                MCP Assistant Authorization
              </p>
            </div>
          </div>

          {authorized ? (
            <div className="mt-md text-center py-md">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="mt-md text-title-md font-semibold text-on-surface">Authorized!</h3>
              <p className="mt-xs text-body-sm text-on-surface-variant">
                Returning to your terminal to configure your AI assistants…
              </p>
            </div>
          ) : (
            <>
              <p className="mt-md text-body-md text-on-surface-variant">
                An AI coding assistant on your machine is requesting access to inspect issues and file findings for QA review.
              </p>

              {error && (
                <div className="mt-md rounded-lg border border-rose-500/30 bg-rose-500/10 p-md text-body-sm text-rose-800 dark:text-rose-300">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="mt-lg flex items-center justify-center py-xl text-body-md text-on-surface-variant">
                  Loading projects…
                </div>
              ) : projects.length === 0 ? (
                <div className="mt-lg rounded-lg bg-surface-container-high p-md text-center">
                  <AlertCircle className="mx-auto h-6 w-6 text-on-surface-variant" />
                  <p className="mt-sm text-body-sm font-medium text-on-surface">No Eligible Projects Found</p>
                  <p className="mt-xs text-body-xs text-on-surface-variant">
                    You must be an Owner of at least one active project to authorize AI assistants.
                  </p>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="mt-md rounded-lg bg-primary px-md py-sm text-sm font-semibold text-on-primary hover:bg-primary-container transition-colors"
                  >
                    Return to Dashboard
                  </button>
                </div>
              ) : (
                <div className="mt-lg flex flex-col gap-md">
                  <div>
                    <label htmlFor="project-select" className="mb-1.5 block text-label-md font-semibold text-on-surface">
                      Project
                    </label>
                    <select
                      id="project-select"
                      value={selectedProjectId}
                      onChange={e => setSelectedProjectId(e.target.value)}
                      disabled={authorizing}
                      className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all disabled:opacity-50"
                    >
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-lg border border-outline-variant bg-surface p-md">
                    <div className="flex items-start gap-sm">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-body-xs text-on-surface-variant">
                        <span className="font-semibold text-on-surface">Project-scoped:</span> Access is strictly limited to issues in <span className="font-medium text-on-surface">{selectedProject?.name}</span>. The assistant cannot access other projects or your account credentials.
                      </p>
                    </div>
                  </div>

                  <div className="mt-sm flex items-center justify-end gap-sm pt-xs">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={authorizing}
                      className="rounded-lg border border-outline-variant px-md py-sm text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAuthorize}
                      disabled={authorizing || !selectedProject}
                      className="rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                    >
                      {authorizing ? 'Authorizing…' : 'Authorize Connection'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

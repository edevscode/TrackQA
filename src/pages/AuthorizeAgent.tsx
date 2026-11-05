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
  const isValidState = Boolean(stateParam && stateParam.length >= 8 && stateParam.length <= 128)

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
      window.location.href = `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(stateParam!)}&error=cancelled`
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
        window.location.href = callbackUrl
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize AI agent.')
      setAuthorizing(false)
    }
  }

  if (!isValidPort || !isValidState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-container-lowest p-4">
        <div className="w-full max-w-md rounded-xl border border-outline-variant bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-3 text-error">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <h2 className="text-title-md font-semibold text-on-surface">Invalid Setup Request</h2>
          </div>
          <p className="mt-3 text-body-sm text-on-surface-variant">
            This setup session is missing a valid loopback port or state token. Please run{' '}
            <code className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-body-xs font-semibold">
              npx trackqa setup
            </code>{' '}
            from your terminal.
          </p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="rounded-lg bg-surface-container-high px-4 py-2 text-label-md font-medium text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-container-lowest p-4 sm:p-6">
      <div className="mb-6">
        <TrackQALogo />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface p-6 shadow-md sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-title-lg font-bold text-on-surface">Authorize AI Assistant</h1>
            <p className="text-body-xs text-on-surface-variant">TrackQA MCP Auto-Setup</p>
          </div>
        </div>

        {authorized ? (
          <div className="mt-6 text-center py-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-title-md font-semibold text-on-surface">Authorized!</h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Returning to your terminal to configure your AI assistants…
            </p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-body-sm text-on-surface-variant">
              An AI coding assistant setup on your machine is requesting access to inspect issues and submit findings.
            </p>

            {error && (
              <div className="mt-4 rounded-lg bg-error-container/40 p-3 text-body-sm text-on-error-container">
                {error}
              </div>
            )}

            {loading ? (
              <div className="mt-6 flex items-center justify-center py-8 text-body-md text-on-surface-variant">
                Loading projects…
              </div>
            ) : projects.length === 0 ? (
              <div className="mt-6 rounded-lg bg-surface-container-high p-4 text-center">
                <AlertCircle className="mx-auto h-6 w-6 text-on-surface-variant" />
                <p className="mt-2 text-body-sm font-medium text-on-surface">No Eligible Projects Found</p>
                <p className="mt-1 text-body-xs text-on-surface-variant">
                  You must be an Owner of at least one active project to authorize AI assistants.
                </p>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-label-md font-medium text-on-primary"
                >
                  Return to Dashboard
                </button>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div>
                  <label htmlFor="project-select" className="block text-label-md font-medium text-on-surface">
                    Select TrackQA Project
                  </label>
                  <select
                    id="project-select"
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    disabled={authorizing}
                    className="mt-1.5 block w-full rounded-lg border border-outline bg-surface px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3.5">
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="text-body-xs text-on-surface-variant">
                      <span className="font-semibold text-on-surface">Project-Scoped Security:</span> Access is strictly restricted to issues in{' '}
                      <span className="font-medium text-on-surface">{selectedProject?.name}</span>. The assistant cannot access other projects or your private account credentials.
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={authorizing}
                    className="rounded-lg border border-outline px-4 py-2 text-label-md font-medium text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAuthorize}
                    disabled={authorizing || !selectedProject}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-50"
                  >
                    {authorizing ? 'Authorizing…' : 'Authorize & Connect'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

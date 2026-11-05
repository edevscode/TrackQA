import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import { supabase } from '../lib/supabase'
import { clientConfigSnippet, connectionFields, connectionStatus, mcpSetup } from '../lib/mcpOnboarding'
import type { McpClientType } from '../lib/mcpOnboarding'
import { isActiveConnection, verifyConnectionRevoked } from '../lib/mcpConnections'
import type { McpConnection, Project, ProjectRole } from '../lib/database.types'
import type { ProjectSettingsMember } from '../lib/cache'
import { useDialogFocus } from '../hooks/useDialogFocus'

type Operation = { type: 'enable'; enabled: boolean } | { type: 'revoke'; connection: McpConnection }
const pageSize = 10

export default function AiIntegrations({ project, userId, role, members, managementOnly = false }: {
  project: Project; userId: string; role: ProjectRole | null; members: ProjectSettingsMember[]; managementOnly?: boolean
}) {
  const isOwner = role === 'OWNER' && !!userId
  const titleId = useId()
  const [access, setAccess] = useState({ enabled: project.mcp_enabled, archived: project.archived })
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingRevocation, setPendingRevocation] = useState<string | null>(null)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [clientTab, setClientTab] = useState<McpClientType>('generic')
  const [copyState, setCopyState] = useState<Record<string, 'copied' | 'failed'>>({})
  const [now, setNow] = useState(Date.now)

  // Generate connection modal states
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generateUserId, setGenerateUserId] = useState(userId)
  const [generateLabel, setGenerateLabel] = useState('AI Client')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  const active = useRef(true)
  const mutating = useRef(false)
  const sequence = useRef(0)
  const cancellation = useRef<AbortController | null>(null)

  let setup: ReturnType<typeof mcpSetup> | null = null
  try {
    setup = mcpSetup(import.meta.env.VITE_SUPABASE_URL, project.id)
  } catch {
    // Fail closed without exposing configuration values.
  }

  const load = useCallback(async () => {
    const version = ++sequence.current
    const signal = cancellation.current?.signal
    try {
      let projectQuery = supabase.from('projects').select('id,mcp_enabled,archived').eq('id', project.id)
      let connectionQuery = supabase.from('mcp_connections').select(connectionFields).eq('project_id', project.id)
        .is('revoked_at', null).gt('token_expires_at', new Date().toISOString())
        .not('user_id', 'is', null).not('approved_by', 'is', null)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize)
      if (signal) { projectQuery = projectQuery.abortSignal(signal); connectionQuery = connectionQuery.abortSignal(signal) }
      const [current, rows] = await Promise.all([projectQuery.single(), connectionQuery])
      if (!active.current || signal?.aborted || version !== sequence.current) return
      if (current.error || rows.error || current.data?.id !== project.id
        || rows.data?.some(row => row.project_id !== project.id)) throw new Error('Unavailable')
      setAccess({ enabled: current.data.mcp_enabled, archived: current.data.archived })
      setConnections(rows.data.slice(0, pageSize))
      setHasMore(rows.data.length > pageSize)
      setLoaded(true)
      setLoadError(null)
      setNow(Date.now())
    } catch {
      if (active.current && !signal?.aborted && version === sequence.current) {
        setLoaded(false)
        setLoadError('Unable to load integrations. Try again.')
      }
    } finally { if (active.current && !signal?.aborted && version === sequence.current) setLoading(false) }
  }, [project.id, page])

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    cancellation.current = controller
    void load()
    const refreshOnFocus = () => { if (!mutating.current) { setLoading(true); void load() } }
    window.addEventListener('focus', refreshOnFocus)
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => { controller.abort(); window.removeEventListener('focus', refreshOnFocus); window.clearInterval(timer) }
  }, [load])

  async function checkRevocation(connectionId: string) {
    const confirmed = await verifyConnectionRevoked(() => supabase.from('mcp_connections')
      .select('id,project_id,revoked_at').eq('project_id', project.id).eq('id', connectionId).maybeSingle(), project.id, connectionId)
    if (active.current) {
      setPendingRevocation(confirmed ? null : connectionId)
      setNotice(confirmed ? 'Connection revoked.' : 'Revocation not yet verified.')
    }
  }

  async function recheckRevocation() {
    if (!isOwner || !pendingRevocation || mutating.current) return
    mutating.current = true
    setBusy(true)
    setError(null)
    try { await checkRevocation(pendingRevocation); if (active.current) await load() }
    finally { mutating.current = false; if (active.current) setBusy(false) }
  }

  async function perform(next: Operation) {
    if (!isOwner || mutating.current || !loaded || (managementOnly && next.type !== 'revoke')) return
    mutating.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (next.type === 'enable') {
        if (access.archived) throw new Error('Unavailable')
        const result = await supabase.from('projects').update({ mcp_enabled: next.enabled }).eq('id', project.id).select('id,mcp_enabled').maybeSingle()
        if (result.error || result.data?.id !== project.id || result.data.mcp_enabled !== next.enabled) throw new Error('Unavailable')
      } else {
        if (next.connection.project_id !== project.id) throw new Error('Unavailable')
        setPendingRevocation(next.connection.id)
        const result = await supabase.rpc('revoke_mcp_connection', { p_connection_id: next.connection.id })
        if (result.error) throw new Error('Unavailable')
        await checkRevocation(next.connection.id)
      }
      if (active.current) await load()
    } catch {
      if (active.current) setError(next.type === 'revoke' ? 'Could not confirm revocation.' : 'Could not verify the access change. Refresh to check.')
    } finally {
      mutating.current = false
      if (active.current) { setBusy(false); setOperation(null) }
    }
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState(prev => ({ ...prev, [key]: 'copied' }))
    } catch {
      setCopyState(prev => ({ ...prev, [key]: 'failed' }))
    }
  }

  async function handleGenerateSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!isOwner || generating || !generateLabel.trim() || !access.enabled || access.archived) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const result = await supabase.rpc('issue_mcp_connection_token', {
        p_project_id: project.id,
        p_user_id: generateUserId,
        p_client_label: generateLabel.trim(),
      })
      if (result.error || !result.data || !Array.isArray(result.data) || result.data.length !== 1 || !result.data[0].access_token) {
        throw new Error('Unavailable')
      }
      setGeneratedToken(result.data[0].access_token)
      setGenerateLabel('AI Client')
      if (active.current) await load()
    } catch {
      if (active.current) {
        setGenerateError('Could not generate connection token. Try again.')
      }
    } finally {
      if (active.current) setGenerating(false)
    }
  }

  function closeGenerateModal() {
    if (!generating) {
      setGeneratedToken(null)
      setShowGenerateModal(false)
      setGenerateError(null)
    }
  }

  const generateModalRef = useDialogFocus(showGenerateModal, closeGenerateModal)

  function refresh() { setLoading(true); void load() }
  function selectPage(next: number) { setPage(next); setLoading(true) }
  const visibleConnections = connections.filter(connection => isActiveConnection(connection, now))

  return <section className="space-y-md rounded-xl border border-outline-variant p-md sm:p-lg" aria-labelledby={titleId}>
    <div>
      <h2 id={titleId} className="text-headline-md font-semibold text-on-surface">{managementOnly ? project.name + ' · Connections' : 'AI Integrations'}</h2>
      <p className="mt-xs text-body-sm text-on-surface-variant">{managementOnly ? 'Manage access for this archived project.' : 'Connect your AI client directly to this project via standard MCP over HTTPS.'}</p>
    </div>
    {!managementOnly && <>
      <div className="flex items-center justify-between gap-md">
        <div className="text-body-md text-on-surface">Project MCP access <span className="ml-xs text-body-sm text-on-surface-variant">{loading ? 'Checking…' : !loaded ? 'Unavailable' : access.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <label className="relative inline-flex items-center">
          <input type="checkbox" role="switch" aria-label="Project MCP access" checked={access.enabled} disabled={!isOwner || busy || loading || !loaded || access.archived} onChange={event => setOperation({ type: 'enable', enabled: event.target.checked })} className="peer sr-only" />
          <span className="h-5 w-9 rounded-full bg-surface-container-highest transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-50" />
          <span className="absolute left-[2px] h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4 peer-disabled:opacity-50" />
        </label>
      </div>

      {!access.archived && access.enabled && setup && <div className="space-y-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
        <div className="flex flex-col gap-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="text-label-md font-semibold text-on-surface">MCP Endpoint</span>
          <button type="button" onClick={() => void copyText(setup.endpoint, 'endpoint')} aria-label="Copy MCP endpoint" className="shrink-0 rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary hover:bg-surface-container-lowest">
            {copyState['endpoint'] === 'copied' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code className="block min-w-0 break-all rounded bg-surface-container-lowest p-sm text-code-sm text-on-surface font-mono">
          {setup.endpoint}
        </code>
        <div className="border-t border-outline-variant/60 pt-sm">
          <div className="flex flex-wrap items-center justify-between gap-xs">
            <span className="text-label-sm font-semibold text-on-surface">Client configuration</span>
            <div className="flex flex-wrap gap-xs">
              {([
                { key: 'generic', label: 'Generic' },
                { key: 'claude', label: 'Claude Code' },
                { key: 'codex', label: 'Codex' },
                { key: 'vscode', label: 'VS Code' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setClientTab(key)}
                  className={`rounded px-xs py-0.5 text-label-xs font-semibold transition-colors ${clientTab === key ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:text-on-surface'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-xs">
            <pre className="max-h-48 overflow-x-auto rounded bg-surface-container-lowest p-sm text-code-xs font-mono text-on-surface">
              {clientConfigSnippet(setup, clientTab)}
            </pre>
            <button
              type="button"
              onClick={() => void copyText(clientConfigSnippet(setup, clientTab), 'config')}
              aria-label="Copy configuration"
              className="absolute right-2 top-2 rounded border border-outline-variant bg-surface-container-lowest px-xs py-0.5 text-label-xs font-semibold text-primary hover:bg-surface-container-low"
            >
              {copyState['config'] === 'copied' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>}

      {!access.archived && access.enabled && isOwner && <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setGenerateError(null); setGeneratedToken(null); setShowGenerateModal(true) }}
          disabled={busy || loading || !loaded || access.archived}
          className="rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
        >
          Generate connection
        </button>
      </div>}
    </>}

    <div className="border-t border-outline-variant pt-md">
      <h3 className="text-body-md font-semibold text-on-surface">Connections</h3>
      {loading ? <p role="status" className="mt-sm text-body-sm text-on-surface-variant">Loading connections…</p>
        : loadError ? <div className="mt-sm"><p role="alert" className="text-body-sm text-error">{loadError}</p><button type="button" onClick={refresh} disabled={busy} className="mt-xs text-label-md font-semibold text-primary disabled:opacity-50">Retry</button></div>
          : visibleConnections.length === 0 ? <p className="mt-sm text-body-sm text-on-surface-variant">No active connections.</p>
            : <ul className="mt-sm divide-y divide-outline-variant">{visibleConnections.map(connection => <li key={connection.id} className="flex items-center justify-between gap-sm py-sm">
              <div className="min-w-0">
                <p className="break-words text-body-md font-semibold text-on-surface">{connection.client_label}</p>
                <p className="text-body-sm text-on-surface-variant">{pendingRevocation === connection.id ? 'Revocation unverified' : connectionStatus(connection, access.enabled, access.archived, managementOnly || members.some(member => member.user_id === connection.user_id), now)}</p>
              </div>
              {isOwner && <button type="button" disabled={busy} onClick={() => setOperation({ type: 'revoke', connection })} className="shrink-0 rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-error hover:bg-error-container disabled:opacity-50">Revoke</button>}
            </li>)}</ul>}
      {(page > 0 || hasMore) && <div className="mt-sm flex justify-end gap-sm text-body-sm text-on-surface-variant"><button type="button" disabled={page === 0 || loading || busy} onClick={() => selectPage(page - 1)} className="disabled:opacity-40">Previous</button><button type="button" disabled={!hasMore || loading || busy} onClick={() => selectPage(page + 1)} className="disabled:opacity-40">Next</button></div>}
    </div>

    {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
    {notice && <p role="status" className="text-body-sm text-on-surface-variant">{notice}</p>}
    {pendingRevocation && isOwner && <button type="button" onClick={() => void recheckRevocation()} disabled={busy || loading} className="rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary disabled:opacity-50">Check revocation</button>}

    <ConfirmModal open={!!operation} onClose={() => { if (!busy) setOperation(null) }} onConfirm={() => { if (operation) void perform(operation) }} isLoading={busy}
      title={operation?.type === 'revoke' ? 'Revoke this connection?' : operation?.enabled ? 'Enable project access?' : 'Disable project access?'}
      description={operation?.type === 'revoke' ? 'Revoke access for “' + operation.connection.client_label + '”?' : operation?.enabled ? 'Enable MCP access for this project? Existing eligible connections may resume.' : 'Block MCP access for this project?'}
      confirmLabel={operation?.type === 'revoke' ? 'Revoke connection' : operation?.enabled ? 'Enable project access' : 'Disable project access'}
      variant={operation?.type === 'revoke' ? 'danger' : 'primary'} />

    {showGenerateModal && (
      <div
        role="dialog"
        ref={generateModalRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="generate-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-md"
      >
        <div
          onClick={closeGenerateModal}
          className="fixed inset-0 bg-black/30 backdrop-blur-[1px]"
        />
        <div className="relative z-10 w-full max-w-[480px] rounded-lg border border-outline-variant bg-surface-container-lowest p-lg shadow-lg">
          <div className="flex items-start justify-between gap-sm">
            <h2 id="generate-modal-title" className="text-headline-md font-semibold text-on-surface">
              {generatedToken ? 'Connection Token' : 'Generate Connection'}
            </h2>
            <button
              type="button"
              disabled={generating}
              onClick={closeGenerateModal}
              aria-label="Close dialog"
              className="rounded p-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>

          {generatedToken ? (
            <div className="mt-md space-y-md">
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-sm text-body-sm text-on-surface">
                <span className="font-semibold text-amber-600 dark:text-amber-400">Secret · Shown once only:</span>{' '}
                This bearer token grants project-scoped MCP access. Store it securely. It will not be shown again.
              </div>
              <div className="space-y-xs">
                <label className="text-label-sm font-semibold text-on-surface">Bearer Token</label>
                <div className="flex items-center gap-sm">
                  <input
                    type="text"
                    readOnly
                    value={generatedToken}
                    aria-label="Generated MCP access token"
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low p-sm font-mono text-code-xs text-on-surface"
                  />
                  <button
                    type="button"
                    onClick={() => void copyText(generatedToken, 'token')}
                    className="shrink-0 rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary"
                  >
                    {copyState['token'] === 'copied' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              {setup && (
                <p className="text-body-xs text-on-surface-variant">
                  Environment variable:{' '}
                  <code className="font-mono">{setup.envVar}</code>
                </p>
              )}
              <div className="flex justify-end pt-sm">
                <button
                  type="button"
                  onClick={closeGenerateModal}
                  className="rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleGenerateSubmit} className="mt-md space-y-md">
              {generateError && (
                <p role="alert" className="text-body-sm text-error">{generateError}</p>
              )}
              <div className="space-y-xs">
                <label htmlFor="mcp-member" className="block text-label-sm font-semibold text-on-surface">
                  Connection member
                </label>
                <select
                  id="mcp-member"
                  value={generateUserId}
                  onChange={e => setGenerateUserId(e.target.value)}
                  disabled={generating}
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md text-on-surface"
                >
                  {members.map(member => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.full_name || member.email}{member.user_id === userId ? ' (you)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-xs">
                <label htmlFor="mcp-label" className="block text-label-sm font-semibold text-on-surface">
                  Device / Client label
                </label>
                <input
                  id="mcp-label"
                  type="text"
                  required
                  maxLength={120}
                  value={generateLabel}
                  onChange={e => setGenerateLabel(e.target.value)}
                  placeholder="e.g. Laptop - Claude Code"
                  disabled={generating}
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md text-on-surface"
                />
              </div>
              <div className="flex items-center justify-end gap-sm pt-sm">
                <button
                  type="button"
                  disabled={generating}
                  onClick={closeGenerateModal}
                  className="rounded-md px-sm py-xs text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating || !generateLabel.trim()}
                  className="rounded-md bg-primary px-md py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
                >
                  {generating ? 'Generating…' : 'Generate token'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    )}
  </section>
}

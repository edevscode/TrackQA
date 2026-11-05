import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Terminal, Copy, Check } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import { supabase } from '../lib/supabase'
import { connectionFields, connectionStatus } from '../lib/mcpOnboarding'
import { isActiveConnection, verifyConnectionRevoked } from '../lib/mcpConnections'
import type { McpConnection, Project, ProjectRole } from '../lib/database.types'
import type { ProjectSettingsMember } from '../lib/cache'

type Operation = { type: 'enable'; enabled: boolean } | { type: 'revoke'; connection: McpConnection }
const pageSize = 10
const SETUP_COMMAND = 'npx trackqa setup'

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
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now)

  const active = useRef(true)
  const mutating = useRef(false)
  const sequence = useRef(0)
  const cancellation = useRef<AbortController | null>(null)

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
    if (!active.current) return
    if (confirmed) {
      setPendingRevocation(null)
      setNotice('Connection revoked.')
    } else {
      setPendingRevocation(connectionId)
      setError('Revocation could not be verified yet. Recheck in a moment.')
    }
  }

  async function recheckRevocation() {
    if (!pendingRevocation || busy) return
    setBusy(true)
    mutating.current = true
    try { await checkRevocation(pendingRevocation); if (active.current) await load() }
    finally { mutating.current = false; if (active.current) setBusy(false) }
  }

  async function perform(next: Operation) {
    if (busy) return
    setBusy(true)
    mutating.current = true
    setError(null)
    setNotice(null)
    try {
      if (next.type === 'enable') {
        const { error: updateError } = await supabase.from('projects').update({ mcp_enabled: next.enabled }).eq('id', project.id)
        if (updateError) throw updateError
        if (active.current) setAccess(prev => ({ ...prev, enabled: next.enabled }))
      } else {
        const { error: rpcError } = await supabase.rpc('revoke_mcp_connection', { p_project_id: project.id, p_connection_id: next.connection.id })
        if (rpcError) throw rpcError
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

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(SETUP_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fail closed
    }
  }

  function refresh() { setLoading(true); void load() }
  function selectPage(next: number) { setPage(next); setLoading(true) }
  const visibleConnections = connections.filter(connection => isActiveConnection(connection, now))

  return <section className="space-y-md rounded-xl border border-outline-variant p-md sm:p-lg" aria-labelledby={titleId}>
    <div>
      <h2 id={titleId} className="text-headline-md font-semibold text-on-surface">{managementOnly ? project.name + ' · Connections' : 'AI Integrations'}</h2>
      <p className="mt-xs text-body-sm text-on-surface-variant">
        {managementOnly ? 'Manage access for this archived project.' : 'Connect AI coding assistants (Google Antigravity, VS Code, Windsurf, Claude Code, Codex) automatically.'}
      </p>
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

      {!access.archived && access.enabled && (
        <div className="space-y-md rounded-xl border border-outline-variant bg-surface-container-low p-md sm:p-lg">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <h3 className="text-title-md font-semibold text-on-surface">Connect AI Agent</h3>
          </div>

          <p className="text-body-sm text-on-surface-variant">
            Run the setup command in your workspace. Your browser will open to confirm project authorization, and your installed AI assistants will be configured automatically.
          </p>

          <div className="flex items-center justify-between gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-sm sm:p-md">
            <code className="min-w-0 font-mono text-body-md font-semibold text-on-surface selection:bg-primary/20">
              {SETUP_COMMAND}
            </code>
            <button
              type="button"
              onClick={() => void copyCommand()}
              aria-label="Copy setup command"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-sm py-xs text-label-md font-semibold text-on-primary hover:bg-primary-container transition-colors"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="grid gap-2 border-t border-outline-variant/60 pt-sm text-body-xs text-on-surface-variant sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[11px] font-bold text-on-surface">1</span>
              <span>Run <code className="font-mono text-on-surface">npx trackqa setup</code> in terminal</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[11px] font-bold text-on-surface">2</span>
              <span>Authorize project in your browser</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[11px] font-bold text-on-surface">3</span>
              <span>AI assistants are configured automatically</span>
            </div>
          </div>
        </div>
      )}
    </>}

    <div className="border-t border-outline-variant pt-md">
      <div className="flex items-center justify-between">
        <h3 className="text-body-md font-semibold text-on-surface">Active Connections</h3>
        <span className="text-body-xs text-on-surface-variant">
          {visibleConnections.length} connected
        </span>
      </div>

      {loading ? (
        <p role="status" className="mt-sm text-body-sm text-on-surface-variant">Loading connections…</p>
      ) : loadError ? (
        <div className="mt-sm">
          <p role="alert" className="text-body-sm text-error">{loadError}</p>
          <button type="button" onClick={refresh} disabled={busy} className="mt-xs text-label-md font-semibold text-primary disabled:opacity-50">Retry</button>
        </div>
      ) : visibleConnections.length === 0 ? (
        <p className="mt-sm text-body-sm text-on-surface-variant">No active connections.</p>
      ) : (
        <ul className="mt-sm divide-y divide-outline-variant">
          {visibleConnections.map(connection => (
            <li key={connection.id} className="flex items-center justify-between gap-sm py-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="break-words text-body-md font-semibold text-on-surface">{connection.client_label}</p>
                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-label-xs font-medium text-emerald-600">
                    Active
                  </span>
                </div>
                <p className="text-body-xs text-on-surface-variant">
                  {pendingRevocation === connection.id ? 'Revocation unverified' : connectionStatus(connection, access.enabled, access.archived, managementOnly || members.some(member => member.user_id === connection.user_id), now)}
                  {' · '}
                  Created {new Date(connection.created_at).toLocaleDateString()}
                </p>
              </div>
              {isOwner && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOperation({ type: 'revoke', connection })}
                  className="shrink-0 rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-error hover:bg-error-container disabled:opacity-50 transition-colors"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(page > 0 || hasMore) && (
        <div className="mt-sm flex justify-end gap-sm text-body-sm text-on-surface-variant">
          <button type="button" disabled={page === 0 || loading || busy} onClick={() => selectPage(page - 1)} className="disabled:opacity-40">Previous</button>
          <button type="button" disabled={!hasMore || loading || busy} onClick={() => selectPage(page + 1)} className="disabled:opacity-40">Next</button>
        </div>
      )}
    </div>

    {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
    {notice && <p role="status" className="text-body-sm text-on-surface-variant">{notice}</p>}
    {pendingRevocation && isOwner && (
      <button type="button" onClick={() => void recheckRevocation()} disabled={busy || loading} className="rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary disabled:opacity-50">
        Check revocation
      </button>
    )}

    <ConfirmModal
      open={!!operation}
      onClose={() => { if (!busy) setOperation(null) }}
      onConfirm={() => { if (operation) void perform(operation) }}
      isLoading={busy}
      title={operation?.type === 'revoke' ? 'Revoke this connection?' : operation?.enabled ? 'Enable project access?' : 'Disable project access?'}
      description={operation?.type === 'revoke' ? 'Revoke access for “' + operation.connection.client_label + '”? The AI client will immediately lose access.' : operation?.enabled ? 'Enable MCP access for this project? Existing eligible connections may resume.' : 'Block MCP access for this project?'}
      confirmLabel={operation?.type === 'revoke' ? 'Revoke connection' : operation?.enabled ? 'Enable project access' : 'Disable project access'}
      variant={operation?.type === 'revoke' ? 'danger' : 'primary'}
    />
  </section>
}

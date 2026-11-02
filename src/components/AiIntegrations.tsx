import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import McpConnectWizard from './McpConnectWizard'
import { supabase } from '../lib/supabase'
import { connectionFields, connectionStatus, issueConnectionToken, mcpSetup, watchTokenReveal } from '../lib/mcpOnboarding'
import type { TokenReveal } from '../lib/mcpOnboarding'
import type { McpConnection, Project, ProjectRole } from '../lib/database.types'
import type { ProjectSettingsMember } from '../lib/cache'

type Operation = { type: 'enable'; enabled: boolean } | { type: 'issue'; userId: string; label: string } | { type: 'revoke'; connection: McpConnection }
const pageSize = 10

export default function AiIntegrations({ project, userId, role, members }: {
  project: Project; userId: string; role: ProjectRole | null; members: ProjectSettingsMember[]
}) {
  const isOwner = role === 'OWNER' && !!userId
  const [access, setAccess] = useState({ enabled: project.mcp_enabled, archived: project.archived })
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const wizardVisible = useRef(false)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<TokenReveal | null>(null)
  const [now, setNow] = useState(Date.now)
  const active = useRef(true)
  const mutating = useRef(false)
  const sequence = useRef(0)
  const cancellation = useRef<AbortController | null>(null)
  let setup
  try { setup = mcpSetup(import.meta.env.VITE_SUPABASE_URL, project.id) } catch { /* Fail closed without exposing configuration values. */ }

  const load = useCallback(async () => {
    const version = ++sequence.current
    const signal = cancellation.current?.signal
    try {
      let projectQuery = supabase.from('projects').select('id,mcp_enabled,archived').eq('id', project.id)
      let connectionQuery = supabase.from('mcp_connections').select(connectionFields).eq('project_id', project.id)
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
        setLoadError('Unable to check integration access. Refresh to verify your current permissions.')
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
    // Synchronize access metadata with the authenticated API; never fetch tokens.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    const refreshOnFocus = () => { if (!mutating.current) { setLoading(true); void load() } }
    window.addEventListener('focus', refreshOnFocus)
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => { controller.abort(); window.removeEventListener('focus', refreshOnFocus); window.clearInterval(timer) }
  }, [load])
  useEffect(() => {
    if (!reveal) return
    return watchTokenReveal(() => setReveal(null), document, window)
  }, [reveal])

  async function perform(operation: Operation): Promise<boolean> {
    if (!isOwner || mutating.current) return false
    mutating.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (operation.type === 'enable') {
        if (!loaded || (operation.enabled && access.archived)) throw new Error('Unavailable')
        const result = await supabase.from('projects').update({ mcp_enabled: operation.enabled }).eq('id', project.id).select('id,mcp_enabled').maybeSingle()
        if (result.error || result.data?.id !== project.id || result.data.mcp_enabled !== operation.enabled) throw new Error('Unavailable')
        if (active.current) setNotice(operation.enabled ? 'MCP enabled for this project. Each connection still needs Owner approval.' : 'MCP disabled. All connections to this project are blocked.')
      } else if (operation.type === 'revoke') {
        if (operation.connection.project_id !== project.id) throw new Error('Unavailable')
        const result = await supabase.rpc('revoke_mcp_connection', { p_connection_id: operation.connection.id })
        if (result.error) throw new Error('Unavailable')
        if (active.current) setNotice('Connection revoked. Its token can no longer authorize requests.')
      } else {
        if (!loaded) throw new Error('Unavailable')
        const issued = await issueConnectionToken(args => supabase.rpc('issue_mcp_connection_token', args), {
          projectId: project.id, userId: operation.userId, isOwner, enabled: access.enabled,
          archived: access.archived, memberIds: members.map(member => member.user_id),
        }, operation.label, value => {
          if (!active.current || !wizardVisible.current || document.hidden) return false
          setOperation(null)
          setReveal(value)
          return true
        })
        if (!issued.displayed) {
          // No token is retained for an account/project that is no longer visible.
          const revoked = await supabase.rpc('revoke_mcp_connection', { p_connection_id: issued.connectionId })
          if (revoked.error) throw new Error('Unavailable')
          if (active.current) setNotice('The token could not be displayed. The new connection was revoked; no token was saved.')
          if (active.current) await load()
          return false
        } else if (active.current) setNotice('Connection approved. Use the one-time token in setup, or revoke access in Manage Connections.')
      }
      if (active.current) await load()
      return active.current
    } catch {
      if (active.current) setError(operation.type === 'issue'
        ? 'Token issuance could not be completed. Refresh connections and revoke any new entry before trying again. Issuance is never automatically retried.'
        : 'The change could not be verified. Refresh to check its current state before trying again.')
      return false
    } finally {
      mutating.current = false
      if (active.current) { setBusy(false); setOperation(null) }
    }
  }

  function closeWizard() {
    if (mutating.current) return
    wizardVisible.current = false
    setReveal(null)
    setWizardOpen(false)
  }
  function refresh() { setLoading(true); void load() }
  function selectPage(next: number) { setPage(next); setLoading(true) }
  const recipientName = (id: string | null) => members.find(member => member.user_id === id)?.full_name
    || members.find(member => member.user_id === id)?.email || 'Former member'
  return <div className="space-y-lg">
    <section className="rounded-xl border border-outline-variant p-md sm:p-lg" aria-labelledby="ai-integrations-title">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 id="ai-integrations-title" className="text-headline-md font-semibold text-on-surface">AI Integrations</h2>
        <span className="rounded-md bg-surface-container-low px-sm py-xs text-label-md text-on-surface-variant">{!loaded ? 'Access not verified' : access.archived ? 'Project archived' : access.enabled ? 'Project access enabled' : 'Project access disabled'}</span>
      </div>
      <p className="mt-sm max-w-[640px] text-body-md text-on-surface-variant">Bring your coding assistant into TrackQA. Read project issues and send potential bugs for human review.</p>
      <button type="button" disabled={!setup || busy || loading || !loaded || access.archived} onClick={() => { setError(null); wizardVisible.current = true; setWizardOpen(true) }} className="mt-md rounded-md bg-primary px-lg py-sm text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50">Connect Codex</button>
      <p className="mt-sm text-body-sm text-on-surface-variant">Guided setup · Claude Code and other MCP clients also available</p>
      <p className="mt-xs text-body-sm text-on-surface-variant">Project access is separate from a live client connection. Verify the connection in your client.</p>
      {access.archived && <p className="mt-sm text-body-sm text-on-surface-variant">Unarchive this project before connecting a client.</p>}
      {!setup && <p role="alert" className="mt-sm text-body-sm text-error">The endpoint configuration could not be verified. Contact the project administrator.</p>}
    </section>
    {!wizardOpen && error && <p role="alert" className="rounded-md bg-error-container p-sm text-body-md text-on-error-container">{error}</p>}
    {notice && <p role="status" className="text-body-sm text-on-surface-variant">{notice}</p>}
    {loadError && <p role="alert" className="text-body-md text-error">{loadError}</p>}
    <details className="rounded-lg border border-outline-variant p-md">
      <summary className="cursor-pointer text-body-lg font-semibold text-on-surface">Manage Connections</summary>
      <section className="mt-md space-y-md" aria-label="Connection management">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 className="text-body-md font-semibold text-on-surface">{isOwner ? 'Project connections' : 'Your connections'}</h3>
          <button type="button" onClick={refresh} disabled={busy || loading} aria-label="Refresh integration status" className="rounded-md border border-outline-variant p-xs text-on-surface-variant disabled:opacity-50"><RefreshCw size={16} /></button>
        </div>
        <p className="text-body-sm text-on-surface-variant">Disabling project access blocks every connection. Re-enabling restores eligible connections. Revocation permanently invalidates an individual token. Access status does not indicate live client activity.</p>
        {isOwner ? <button type="button" disabled={busy || loading || !loaded || !setup || (access.archived && !access.enabled)} onClick={() => setOperation({ type: 'enable', enabled: !access.enabled })} className="rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary disabled:opacity-50">{access.enabled ? 'Disable project access' : 'Enable project access'}</button> : <p className="text-body-sm text-on-surface-variant">Only Owners can enable project access, issue tokens or revoke connections.</p>}
        {loading ? <p role="status" className="text-body-md text-on-surface-variant">Checking access…</p> : connections.length === 0 && !loadError ? <p className="text-body-md text-on-surface-variant">{isOwner ? 'No connections yet. Use Connect Codex to get started.' : 'No connections visible for your account. Ask an Owner for access.'}</p> : <ul className="divide-y divide-outline-variant">{connections.map(connection => <li key={connection.id} className="flex flex-col justify-between gap-sm py-sm sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="break-words text-body-md font-semibold text-on-surface">{connection.client_label}</p>
            <p className="text-body-sm text-on-surface-variant">{recipientName(connection.user_id)} · {loaded ? connectionStatus(connection, access.enabled, access.archived, members.some(member => member.user_id === connection.user_id), now) : 'Access not verified'}</p>
            <p className="text-body-sm text-on-surface-variant">Expires {new Date(connection.token_expires_at).toLocaleString()}</p>
            <details className="mt-xs text-body-sm text-on-surface-variant"><summary className="cursor-pointer">Advanced: connection ID</summary><p className="break-all font-mono text-code-xs">{connection.id}</p></details>
          </div>
          {isOwner && !connection.revoked_at && <button type="button" disabled={busy} onClick={() => setOperation({ type: 'revoke', connection })} className="self-start rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-error hover:bg-error-container disabled:opacity-50">Revoke</button>}
        </li>)}</ul>}
        {(page > 0 || hasMore) && <div className="flex justify-end gap-sm text-body-sm text-on-surface-variant"><button type="button" disabled={page === 0 || loading || busy} onClick={() => selectPage(page - 1)} className="disabled:opacity-40">Previous</button><span>Page {page + 1}</span><button type="button" disabled={!hasMore || loading || busy} onClick={() => selectPage(page + 1)} className="disabled:opacity-40">Next</button></div>}
      </section>
    </details>
    {wizardOpen && setup && <McpConnectWizard setup={setup} isOwner={isOwner} userId={userId} members={members} enabled={access.enabled} available={loaded && !loading && !access.archived} busy={busy} error={error} reveal={reveal} onEnable={() => perform({ type: 'enable', enabled: true })} onIssue={(userId, label) => perform({ type: 'issue', userId, label })} onDiscard={() => setReveal(null)} onClose={closeWizard} canReview={role === 'QA' || isOwner} />}
    <ConfirmModal open={!!operation} onClose={() => { if (!busy) setOperation(null) }} onConfirm={() => { if (operation) void perform(operation) }} isLoading={busy}
      title={operation?.type === 'revoke' ? 'Revoke this connection?' : operation?.type === 'enable' && operation.enabled ? 'Enable project access?' : 'Disable project access?'}
      description={operation?.type === 'revoke' ? `Permanently invalidate the token for "${operation.connection.client_label}". Other connections are unaffected.` : operation?.type === 'enable' && operation.enabled ? 'Owner-approved connections will be able to read issues and submit findings for human review. Eligible existing connections may resume.' : 'All connections to this project will be blocked. Tokens may work again if access is re-enabled before expiry. Revoke a connection to permanently invalidate it.'}
      confirmLabel={operation?.type === 'revoke' ? 'Revoke connection' : operation?.type === 'enable' && operation.enabled ? 'Enable project access' : 'Disable project access'}
      variant={operation?.type === 'revoke' ? 'danger' : 'primary'} />
  </div>
}

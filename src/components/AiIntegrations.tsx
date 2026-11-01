import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import ConfirmModal from './ConfirmModal'
import McpSetupGuide from './McpSetupGuide'
import { supabase } from '../lib/supabase'
import { connectionFields, connectionStatus, issueConnectionToken, mcpSetup, watchTokenReveal } from '../lib/mcpOnboarding'
import type { TokenReveal } from '../lib/mcpOnboarding'
import type { McpConnection, Project, ProjectRole } from '../lib/database.types'
import type { ProjectSettingsMember } from '../lib/cache'

type Operation = { type: 'enable'; enabled: boolean } | { type: 'issue'; userId: string; label: string } | { type: 'revoke'; connection: McpConnection }
const inputClass = 'w-full rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary disabled:opacity-50'
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
  const [recipient, setRecipient] = useState(userId)
  const [label, setLabel] = useState('')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<TokenReveal | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [tokenCopyFailed, setTokenCopyFailed] = useState(false)
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

  async function perform() {
    if (!operation || !isOwner || mutating.current) return
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
          if (!active.current || document.hidden) return false
          setOperation(null)
          setReveal(value)
          setTokenCopied(false)
          setTokenCopyFailed(false)
          return true
        })
        if (!issued.displayed) {
          // No token is retained for an account/project that is no longer visible.
          const revoked = await supabase.rpc('revoke_mcp_connection', { p_connection_id: issued.connectionId })
          if (revoked.error) throw new Error('Unavailable')
          if (active.current) setNotice('The token could not be displayed. The new connection was revoked; no token was saved.')
        } else if (active.current) { setLabel(''); setNotice('Connection approved. The token is available only in the one-time dialog.') }
      }
      if (active.current) await load()
    } catch {
      if (active.current) setError(operation.type === 'issue'
        ? 'Token issuance could not be completed. Refresh connections and revoke any new entry before trying again. Issuance is never automatically retried.'
        : 'The change could not be verified. Refresh to check its current state before trying again.')
    } finally {
      mutating.current = false
      if (active.current) { setBusy(false); setOperation(null) }
    }
  }

  async function copyToken() {
    if (!reveal) return
    try { await navigator.clipboard.writeText(reveal.token); if (active.current) { setTokenCopied(true); setTokenCopyFailed(false) } }
    catch { if (active.current) setTokenCopyFailed(true) }
  }
  function refresh() { setLoading(true); void load() }
  function selectPage(next: number) { setPage(next); setLoading(true) }
  const recipientName = (id: string | null) => members.find(member => member.user_id === id)?.full_name
    || members.find(member => member.user_id === id)?.email || 'Former member'
  const controls = isOwner ? <form className="space-y-sm" onSubmit={event => {
    event.preventDefault()
    if (loaded && access.enabled && !access.archived && label.trim() && members.some(member => member.user_id === recipient)) {
      setOperation({ type: 'issue', userId: recipient, label: label.trim() })
    }
  }}>
    <p className="text-body-md text-on-surface-variant">Approve one connection per developer and device. Tokens are shown only once, expire after 90 days by default and can be revoked at any time.</p>
    <div className="grid gap-sm sm:grid-cols-2">
      <label className="text-label-md font-semibold text-on-surface">Connection belongs to<select aria-label="Connection member" value={recipient} onChange={event => setRecipient(event.target.value)} disabled={busy} className={`mt-xs ${inputClass}`}>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}{member.user_id === userId ? ' (you)' : ''}</option>)}</select></label>
      <label className="text-label-md font-semibold text-on-surface">Device or client label<input value={label} onChange={event => setLabel(event.target.value)} required maxLength={120} disabled={busy} placeholder="e.g. My work laptop" className={`mt-xs ${inputClass}`} /></label>
    </div>
    <p className="text-body-sm text-on-surface-variant">For another member, deliver the token through your approved secure channel. Never send it through AI chat, an issue or a shared configuration file.</p>
    <button type="submit" disabled={busy || loading || !loaded || !access.enabled || access.archived || !label.trim() || !members.some(member => member.user_id === recipient)} className="rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50">Approve & issue token</button>
    {!access.enabled && <p className="text-body-sm text-on-surface-variant">Enable project access above before issuing a token.</p>}
  </form> : <p className="text-body-md text-on-surface-variant">Ask a project Owner to enable MCP and approve a connection for your account. Receive the one-time token through your approved secure channel and enter it only at the masked terminal prompt. Only Owners can issue or revoke connections.</p>

  return <div>
    <div className="mb-md flex flex-wrap items-start justify-between gap-sm border-b border-outline-variant pb-sm">
      <div><h2 className="text-body-md font-bold uppercase tracking-wider text-on-surface">AI Integrations</h2><p className="mt-xs text-body-sm text-on-surface-variant">Connect your coding agent to this project. Read issues, submit findings and keep official issue creation under human review.</p></div>
      <div className="flex items-center gap-sm">
        <span className="rounded-md bg-surface-container-low px-sm py-xs text-label-md font-semibold text-on-surface">{!loaded ? 'Access not verified' : access.archived ? 'Archived' : access.enabled ? 'MCP enabled' : 'MCP disabled'}</span>
        {isOwner && <button type="button" disabled={busy || loading || !loaded || !setup || (access.archived && !access.enabled)} onClick={() => setOperation({ type: 'enable', enabled: !access.enabled })} className="rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary hover:bg-primary-fixed/30 disabled:opacity-50">{access.enabled ? 'Disable MCP' : 'Enable MCP'}</button>}
      </div>
    </div>
    {error && <p role="alert" className="mb-sm rounded-md bg-error-container p-sm text-body-md text-on-error-container">{error}</p>}
    {notice && <p role="status" className="mb-sm rounded-md bg-surface-container-low p-sm text-body-md text-on-surface">{notice}</p>}
    {loadError && <p role="alert" className="mb-sm text-body-md text-error">{loadError}</p>}
    {setup ? <McpSetupGuide setup={setup} accessControls={controls} canReview={role === 'QA' || isOwner} /> : <p role="alert" className="text-body-md text-error">MCP setup is unavailable because the endpoint configuration could not be verified. Contact the project administrator.</p>}

    <section className="mt-lg border-t border-outline-variant pt-md" aria-labelledby="mcp-connections">
      <div className="mb-sm flex items-center justify-between gap-sm"><h3 id="mcp-connections" className="text-body-lg font-semibold text-on-surface">{isOwner ? 'Project connections' : 'Your connections'}</h3><button type="button" onClick={refresh} disabled={busy || loading} aria-label="Refresh integration status" title="Refresh integration status" className="rounded-md border border-outline-variant p-xs text-on-surface-variant disabled:opacity-50"><RefreshCw size={16} /></button></div>
      <p className="mb-sm text-body-sm text-on-surface-variant">Access state reflects current settings, not live client activity. Disabling MCP blocks access; re-enabling restores eligible connections. Revoke a connection to permanently invalidate its token.</p>
      {loading ? <p role="status" className="text-body-md text-on-surface-variant">Checking access…</p> : connections.length === 0 && !loadError ? <p className="rounded-md bg-surface-container-low p-sm text-body-md text-on-surface-variant">{isOwner ? 'No connections yet. Approve a developer’s first connection in step 2.' : 'No connections visible for your account. Ask a project Owner for access.'}</p> : <ul className="divide-y divide-outline-variant">{connections.map(connection => <li key={connection.id} className="flex flex-col justify-between gap-sm py-sm sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="break-words text-body-md font-semibold text-on-surface">{connection.client_label}</p>
          <p className="text-body-sm text-on-surface-variant">{recipientName(connection.user_id)} · {loaded ? connectionStatus(connection, access.enabled, access.archived, members.some(member => member.user_id === connection.user_id), now) : 'Access not verified'}</p>
          <p className="text-body-sm text-on-surface-variant">Expires {new Date(connection.token_expires_at).toLocaleString()}</p>
          <p className="break-all font-mono text-code-xs text-on-surface-variant">ID: {connection.id}</p>
        </div>
        {isOwner && !connection.revoked_at && <button type="button" disabled={busy} onClick={() => setOperation({ type: 'revoke', connection })} className="self-start rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-error hover:bg-error-container disabled:opacity-50">Revoke</button>}
      </li>)}</ul>}
      {(page > 0 || hasMore) && <div className="mt-sm flex justify-end gap-sm text-body-sm text-on-surface-variant"><button type="button" disabled={page === 0 || loading || busy} onClick={() => selectPage(page - 1)} className="disabled:opacity-40">Previous</button><span>Page {page + 1}</span><button type="button" disabled={!hasMore || loading || busy} onClick={() => selectPage(page + 1)} className="disabled:opacity-40">Next</button></div>}
    </section>

    <ConfirmModal open={!!operation} onClose={() => { if (!busy) setOperation(null) }} onConfirm={perform} isLoading={busy}
      title={operation?.type === 'issue' ? 'Approve this connection?' : operation?.type === 'revoke' ? 'Revoke this connection?' : operation?.type === 'enable' && operation.enabled ? 'Enable MCP for this project?' : 'Disable MCP for this project?'}
      description={operation?.type === 'issue' ? `Issue one token for ${recipientName(operation.userId)} on “${operation.label}”. It expires after 90 days and will be displayed only once. Prepare the masked terminal prompt before continuing.` : operation?.type === 'revoke' ? `Permanently invalidate the token for “${operation.connection.client_label}”. Other connections are unaffected.` : operation?.type === 'enable' && operation.enabled ? 'Owner-approved project connections will be able to read issues and submit pending findings. Human QA/Owner review is still required to create official issues.' : 'All MCP connections to this project will be blocked immediately. Their tokens remain revocable and may work again if MCP is re-enabled before expiry.'}
      confirmLabel={operation?.type === 'issue' ? 'Approve & issue token' : operation?.type === 'revoke' ? 'Revoke connection' : operation?.type === 'enable' && operation.enabled ? 'Enable MCP' : 'Disable MCP'}
      variant={operation?.type === 'revoke' ? 'danger' : 'primary'} />
    <ConfirmModal open={!!reveal} onClose={() => setReveal(null)} onConfirm={() => setReveal(null)} title="Save this token now" confirmLabel="Close & discard this copy" variant="primary"
      description={<div className="space-y-sm">
        <p>This is the only display of this token. It disappears when this dialog closes, the page is hidden, or after two minutes. The token itself remains valid until expiry or revocation.</p>
        <textarea aria-label="One-time MCP token" readOnly autoComplete="off" spellCheck={false} value={reveal?.token ?? ''} rows={3} className={`${inputClass} break-all font-mono text-code-sm`} />
        <button type="button" onClick={() => void copyToken()} className="inline-flex items-center gap-xs rounded-md border border-outline-variant px-sm py-xs font-semibold text-primary"><Copy size={14} />{tokenCopied ? 'Token copied' : 'Copy token'}</button>
        {tokenCopyFailed && <p role="alert" className="text-error">Copy failed. Select the token and copy it manually, or revoke this connection if the token is lost.</p>}
        <p>Paste only into the waiting hidden terminal prompt. Clear clipboard contents/history afterward. Never paste into a command, file, log or AI chat. If lost, revoke the connection and issue another.</p>
        {reveal && <p className="break-all text-code-xs">Connection ID: {reveal.connectionId}</p>}
      </div>} />
  </div>
}

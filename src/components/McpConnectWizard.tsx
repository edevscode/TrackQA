import { useState } from 'react'
import { X } from 'lucide-react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import McpSetupGuide from './McpSetupGuide'
import type { McpClient, McpSetup, TokenReveal } from '../lib/mcpOnboarding'
import type { ProjectSettingsMember } from '../lib/cache'

const clientNames = { codex: 'Codex CLI', claude: 'Claude Code', generic: 'Other MCP client' } as const
const primary = 'rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50'
const input = 'mt-xs w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md text-on-surface'
const titles = ['Choose your client', 'Prepare & approve access', 'Enter your token', 'Verify in your client']

export default function McpConnectWizard({ setup, isOwner, userId, members, enabled, available, busy, error, reveal, onEnable, onIssue, onDiscard, onClose, canReview }: {
  setup: McpSetup; isOwner: boolean; userId: string; members: ProjectSettingsMember[]
  enabled: boolean; available: boolean; busy: boolean; error: string | null; reveal: TokenReveal | null
  onEnable: () => Promise<boolean>; onIssue: (userId: string, label: string) => Promise<boolean>
  onDiscard: () => void; onClose: () => void; canReview: boolean
}) {
  const [step, setStep] = useState(0)
  const [client, setClient] = useState<McpClient>('codex')
  const [recipient, setRecipient] = useState(userId)
  const [label, setLabel] = useState('My development computer')
  const [ready, setReady] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const dialog = useDialogFocus(true, () => { if (!busy) onClose() })
  const recipientValid = members.some(member => member.user_id === recipient)
  async function advance() {
    if (busy) return
    if (step === 0) setStep(1)
    else if (step === 1) {
      if (!available) return
      if (!enabled) { if (isOwner) await onEnable(); return }
      if (!ready) return
      if (!isOwner || (recipientValid && label.trim() && await onIssue(recipient, label.trim()))) setStep(2)
    } else if (step === 2) { onDiscard(); setStep(3) }
    else onClose()
  }
  const needsCopy = step === 2 && !!reveal && !copied
  const action = needsCopy ? 'Copy token' : step === 0 ? 'Continue' : step === 1
    ? !enabled ? isOwner ? 'Enable project access' : 'Ask an Owner for access' : isOwner ? 'Approve & show token' : 'Continue with Owner-issued token'
    : step === 2 ? 'Continue to verification' : 'Done'
  async function copy() {
    if (!reveal) return
    try { await navigator.clipboard.writeText(reveal.token); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-sm backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="mcp-wizard-title" tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl">
      <header className="flex items-start justify-between gap-sm border-b border-outline-variant p-md">
        <div><p className="mb-xs text-label-md font-semibold text-primary">Connect to TrackQA · Step {step + 1} of 4</p><h2 id="mcp-wizard-title" className="text-headline-md font-semibold text-on-surface">{titles[step]}</h2></div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close setup" className="rounded-md p-xs text-on-surface-variant disabled:opacity-50"><X size={20} /></button>
      </header>
      <div className="min-w-0 space-y-md overflow-y-auto p-md">
        {error && <p role="alert" className="rounded-md bg-error-container p-sm text-body-md text-on-error-container">{error}</p>}
        {step === 0 && <>
          <p className="text-body-md text-on-surface-variant">Read project issues and send potential bugs for human review. Choose the client you already use.</p>
          <fieldset className="space-y-sm"><legend className="sr-only">MCP client</legend>{(Object.keys(clientNames) as McpClient[]).map(value => <label key={value} className={`flex cursor-pointer items-center gap-sm rounded-lg border p-md ${client === value ? 'border-primary bg-primary-fixed/20' : 'border-outline-variant'}`}><input type="radio" name="mcp-client" checked={client === value} onChange={() => setClient(value)} /><span className="text-body-md font-semibold text-on-surface">{clientNames[value]}{value === 'codex' && <span className="ml-sm text-body-sm font-normal text-on-surface-variant">Recommended</span>}</span></label>)}</fieldset>
          <p className="text-body-sm text-on-surface-variant">Codex has been verified with TrackQA. Claude Code and other clients require their supported remote MCP setup.</p>
        </>}
        {step === 1 && <>
          <McpSetupGuide key={client} setup={setup} client={client} phase="prepare" />
          <label className="flex items-start gap-sm text-body-md text-on-surface"><input type="checkbox" className="mt-xs" checked={ready} onChange={event => setReady(event.target.checked)} />The developer’s secure token prompt is ready.</label>
          {isOwner ? <div className="space-y-sm border-t border-outline-variant pt-md">
            <p className="text-body-md text-on-surface">Approve one developer and device for this project only. Tokens are shown once, expire after 90 days by default and can be revoked at any time.</p>
            <label className="block text-label-md font-semibold text-on-surface">Connection member<select value={recipient} onChange={event => setRecipient(event.target.value)} disabled={busy} className={input}>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}{member.user_id === userId ? ' (you)' : ''}</option>)}</select></label>
            <label className="block text-label-md font-semibold text-on-surface">Device label<input value={label} onChange={event => setLabel(event.target.value)} maxLength={120} disabled={busy} className={input} /></label>
            {recipient !== userId && <p className="text-body-sm text-on-surface-variant">Deliver the token only through your approved secure channel. Never send it in AI chat or a shared file.</p>}
            {!enabled && <p className="text-body-sm text-on-surface-variant">Enable project access first. Eligible existing connections may resume; new connections still require your approval.</p>}
          </div> : <p className="rounded-md bg-surface-container-low p-sm text-body-md text-on-surface-variant">Only an Owner can enable access and issue or revoke tokens. Ask your Owner for a one-time token through an approved secure channel.{!enabled && ' Project access is currently disabled.'}</p>}
          {!available && <p role="status" className="text-body-sm text-error">Access must be verified and the project unarchived before continuing.</p>}
        </>}
        {step === 2 && <>
          {reveal ? <><p className="text-body-md text-on-surface">Copy this token into the waiting hidden prompt, then return here. Do not save it in your configuration or paste it into a command or AI chat.</p><textarea aria-label="One-time MCP token" readOnly autoComplete="off" spellCheck={false} value={reveal.token} rows={3} className={`${input} break-all font-mono text-code-sm`} /><p className="text-body-sm text-on-surface-variant">This is its only display. Closing setup, hiding this tab or waiting two minutes clears it. The token remains valid until expiry or revocation.</p></> : <p className="text-body-md text-on-surface-variant">{isOwner ? 'The one-time display has ended. If you already entered your token, continue. Otherwise revoke this connection in Manage Connections and start again.' : 'Enter the token provided by your Owner into the waiting hidden prompt. Do not paste it into this website or save it in a file.'}</p>}
          {copyFailed && <p role="alert" className="text-body-sm text-error">Copy failed. Select and copy the token manually, then confirm below.</p>}
          {copyFailed && <button type="button" onClick={() => setCopied(true)} className="text-label-md text-primary underline">I copied the token manually</button>}
          <p className="text-body-sm text-on-surface-variant">Clear clipboard contents and history after pasting. A lost token cannot be recovered; revoke it and issue a replacement.</p>
        </>}
        {step === 3 && <McpSetupGuide setup={setup} client={client} phase="verify" canReview={canReview} />}
      </div>
      <footer className="flex items-center justify-between gap-sm border-t border-outline-variant p-md">
        {step === 1 ? <button type="button" disabled={busy} onClick={() => { setReady(false); setStep(0) }} className="text-label-md text-on-surface-variant disabled:opacity-50">Back</button> : <span />}
        <button type="button" disabled={busy || (step === 1 && (!available || (!enabled && !isOwner) || (enabled && (!ready || (isOwner && (!recipientValid || !label.trim()))))))} onClick={() => void (needsCopy ? copy() : advance())} className={primary}>{busy ? 'Please wait…' : action}</button>
      </footer>
    </div>
  </div>
}

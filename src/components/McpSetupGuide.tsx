import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { clientConfig, clientDocs, clientLaunch, mcpTools } from '../lib/mcpOnboarding'
import type { McpClient, McpSetup, Terminal } from '../lib/mcpOnboarding'

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState('copied') }
    catch { setState('failed') }
  }
  return <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-outline-variant">
    <div className="flex items-center justify-between gap-sm bg-surface-container-low px-sm py-xs">
      <span className="text-label-md font-semibold text-on-surface-variant">{label}</span>
      <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} className="inline-flex items-center gap-xs rounded p-xs text-label-md text-primary hover:bg-primary-fixed/30">
        {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}{state === 'copied' ? 'Copied' : 'Copy'}
      </button>
    </div>
    <pre className="max-h-80 overflow-auto bg-surface-container-lowest p-sm text-code-sm text-on-surface"><code>{text}</code></pre>
    {state === 'failed' && <p role="status" className="px-sm pb-sm text-body-sm text-error">Copy failed. Select the text and copy it manually.</p>}
  </div>
}

export default function McpSetupGuide({ setup, accessControls, canReview }: { setup: McpSetup; accessControls: ReactNode; canReview: boolean }) {
  const [client, setClient] = useState<McpClient>('codex')
  const [terminal, setTerminal] = useState<Terminal>('powershell')
  const config = clientConfig(setup, client)
  return <div className="min-w-0 space-y-lg">
    <section className="space-y-sm" aria-labelledby="mcp-configure">
      <h3 id="mcp-configure" className="text-body-lg font-semibold text-on-surface">1. Prepare your client</h3>
      <div className="flex flex-wrap gap-xs" role="group" aria-label="MCP client">
        {([['codex', 'Codex CLI'], ['claude', 'Claude Code'], ['generic', 'Other client']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={client === value} onClick={() => setClient(value)} className={`rounded-md border px-sm py-xs text-label-md font-semibold ${client === value ? 'border-primary bg-primary-fixed/30 text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'}`}>{label}</button>)}
      </div>
      <CopyBlock label="Streamable HTTP endpoint" text={setup.endpoint} />
      {config ? <>
        <p className="text-body-md text-on-surface-variant">{client === 'codex' ? 'Merge this entry into ~/.codex/config.toml (in your user home folder).' : 'Merge this entry into .mcp.json in your coding project. Keep any existing servers.'} This configuration contains an environment reference, never your token.</p>
        <CopyBlock key={client} label={client === 'codex' ? 'Codex configuration' : 'Claude Code configuration'} text={config} />
        <a href={clientDocs[client === 'codex' ? 'codex' : 'claude']} target="_blank" rel="noreferrer" className="inline-block text-body-sm text-primary underline">Official {client === 'codex' ? 'Codex' : 'Claude Code'} setup reference</a>
        <div className="flex flex-wrap items-center gap-sm">
          <label htmlFor="mcp-terminal" className="text-label-md font-semibold text-on-surface">Your terminal</label>
          <select id="mcp-terminal" value={terminal} onChange={event => setTerminal(event.target.value as Terminal)} className="rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-body-md text-on-surface"><option value="powershell">PowerShell</option><option value="bash">Bash (macOS / Linux)</option></select>
        </div>
        <p className="text-body-md text-on-surface-variant">Run this in a trusted terminal first; leave it waiting at the hidden token prompt. Then get your token in step 2. The client inherits it for this session, and the launcher clears it when the client exits.</p>
        {client !== 'generic' && <CopyBlock key={`${client}:${terminal}`} label="Masked token prompt and client launch" text={clientLaunch(setup, client, terminal)} />}
      </> : <div className="space-y-xs text-body-md text-on-surface-variant">
        <p>Select <strong>Streamable HTTP</strong> and the endpoint above. Bind the <code>Authorization</code> header to a runtime bearer secret using your client’s documented environment or secret mechanism.</p>
        <p>Suggested environment variable: <code className="break-all">{setup.envVar}</code>. The runtime header must be <code>Bearer</code> followed by a space and the token.</p>
        <p>Environment substitution syntax varies by client. OAuth-only clients and clients that require saving literal tokens are not supported by this setup guide.</p>
      </div>}
      <p className="text-body-sm text-on-surface-variant">Keep tokens out of configuration files, commands, shell history, screenshots and AI chat. Use a terminal without tracing or recording; clear clipboard contents/history after the handoff. Session environment variables remain accessible to trusted processes running as your account.</p>
    </section>

    <section className="space-y-sm border-t border-outline-variant pt-md" aria-labelledby="mcp-access">
      <h3 id="mcp-access" className="text-body-lg font-semibold text-on-surface">2. Get Owner-approved access</h3>
      {accessControls}
    </section>

    <section className="space-y-sm border-t border-outline-variant pt-md" aria-labelledby="mcp-verify">
      <h3 id="mcp-verify" className="text-body-lg font-semibold text-on-surface">3. Verify in your client</h3>
      <p className="text-body-md text-on-surface-variant">{client === 'generic' ? 'Open your client’s MCP server status view.' : 'After entering the token, open /mcp in the client to check server status.'} Allow the TrackQA server when prompted. Ask for a read-only check:</p>
      <CopyBlock label="Connection check prompt" text={`Call trackqa_connection_status and trackqa_list_projects. Confirm that the only authorized project_id is ${setup.projectId}. Do not submit a finding for this connection check.`} />
      <p className="text-body-sm text-on-surface-variant">TrackQA shows access eligibility, not a live IDE connection. A successful tool call in your client verifies the connection. This server uses a TrackQA bearer token; no MCP OAuth login is required.</p>
    </section>

    <details className="rounded-md border border-outline-variant p-sm text-body-md text-on-surface">
      <summary className="cursor-pointer font-semibold">Available tools and human review</summary>
      <ul className="mt-sm space-y-sm">{mcpTools.map(tool => <li key={tool.name}><code className="break-all text-code-sm text-primary">{tool.name}</code><p className="text-body-sm text-on-surface-variant">{tool.description}</p></li>)}</ul>
      <p className="mt-sm text-body-md text-on-surface-variant">Findings enter Pending Review. Only a human QA/Owner can confirm or reject them; confirmation creates one official issue with the reviewer as reporter. Agents cannot approve findings or directly edit issues. Exclude secrets and personal data from evidence.</p>
      {canReview && <Link to="/ai-findings" className="mt-sm inline-block font-semibold text-primary underline">Open AI Findings</Link>}
    </details>
    <details className="rounded-md border border-outline-variant p-sm text-body-md text-on-surface">
      <summary className="cursor-pointer font-semibold">Connection troubleshooting</summary>
      <dl className="mt-sm space-y-sm text-body-sm text-on-surface-variant">
        <div><dt className="font-semibold text-on-surface">401 / Unauthorized</dt><dd>Check the token is available to the client’s process. Ask the Owner to check expiry, revocation, project enablement and current membership. Browser sign-in and Supabase API keys are not MCP tokens.</dd></div>
        <div><dt className="font-semibold text-on-surface">403 / Host or Origin rejected</dt><dd>Use a supported remote MCP client and the exact endpoint. Browser fetch requests may be rejected. Do not change security headers or broaden server access.</dd></div>
        <div><dt className="font-semibold text-on-surface">Server missing or only four tools</dt><dd>Check the configuration file, workspace trust and client version, then restart the client from the terminal holding the token. Older tool allowlists need trackqa_submit_finding. Claude Code needs documented header environment expansion; do not replace the reference with a literal token.</dd></div>
        <div><dt className="font-semibold text-on-surface">Finding retry</dt><dd>Reuse the same submission_id and identical payload after an uncertain response. Changing the payload under that ID conflicts. Use a new ID for a different finding.</dd></div>
      </dl>
      <p className="mt-sm text-body-sm text-on-surface-variant">When requesting help, share only the client version, server name, HTTP status and connection ID. Never share tokens, Authorization headers or raw authentication logs.</p>
    </details>
  </div>
}

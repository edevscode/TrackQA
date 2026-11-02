import { useState } from 'react'
import { Link } from 'react-router-dom'
import { clientConfig, clientDocs, clientLaunch, mcpTools } from '../lib/mcpOnboarding'
import type { McpClient, McpSetup, Terminal } from '../lib/mcpOnboarding'

function CopyInstruction({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return <div className="space-y-xs">
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setState('copied') }
      catch { setState('failed') }
    }} className="rounded-md border border-outline-variant px-sm py-xs text-label-md font-semibold text-primary">{state === 'copied' ? `${label} copied` : `Copy ${label}`}</button>
    {state === 'failed' && <p role="status" className="text-body-sm text-error">Copy failed. Expand Advanced to select the text manually.</p>}
  </div>
}

export default function McpSetupGuide({ setup, client, phase, canReview = false }: {
  setup: McpSetup; client: McpClient; phase: 'prepare' | 'verify'; canReview?: boolean
}) {
  const [terminal, setTerminal] = useState<Terminal>('powershell')
  const config = clientConfig(setup, client)
  const launch = client === 'generic' ? null : clientLaunch(setup, client, terminal)
  const prompt = `Call trackqa_connection_status and trackqa_list_projects. Confirm that the only authorized project_id is ${setup.projectId}. Do not submit a finding for this connection check.`
  return <div className="min-w-0 space-y-md text-body-md text-on-surface-variant">
    {phase === 'prepare' ? <>
      <p>Prepare your client before getting a token. This page cannot configure your local IDE for you.</p>
      {config && launch ? <ol className="list-decimal space-y-md pl-md">
        <li><p className="mb-xs">Merge the configuration into <code>{client === 'codex' ? '~/.codex/config.toml' : '.mcp.json'}</code>{client === 'claude' && ' in your coding project'}. Keep existing servers. It contains no token.</p><CopyInstruction key={client} label="configuration" text={config} /></li>
        <li><label className="mb-xs block text-label-md font-semibold text-on-surface">Your terminal <select value={terminal} onChange={event => setTerminal(event.target.value as Terminal)} className="ml-xs rounded-md border border-outline-variant bg-surface-container-lowest p-xs"><option value="powershell">PowerShell</option><option value="bash">Bash (macOS / Linux)</option></select></label><p className="mb-xs">Run the launcher in a trusted terminal. Leave it waiting at the hidden token prompt.</p><CopyInstruction key={`${client}:${terminal}`} label="secure launcher" text={launch} /></li>
      </ol> : <><p>Your client must support remote Streamable HTTP and a runtime bearer secret. Prepare its secure token prompt using its documentation. Clients that require saving literal tokens or only support OAuth are not supported here.</p><CopyInstruction label="endpoint" text={setup.endpoint} /></>}
      <p className="text-body-sm">Never save or share your token. Paste only into the hidden prompt and clear clipboard contents/history afterward.</p>
    </> : <>
      <p>{client === 'generic' ? 'Open your client’s MCP server status view.' : 'Open /mcp in your client and allow the TrackQA server when prompted.'} Ask your agent to show your TrackQA project. Check that only this project is returned.</p>
      <p>A successful tool call in your client verifies the connection. TrackQA cannot detect a live IDE connection from this page.</p>
      <p>Agents can read issues and submit potential bugs. Findings enter Pending Review; only a human QA/Owner can confirm or reject them. Confirmation creates one official issue.</p>
      {canReview && <Link to="/ai-findings" className="inline-block font-semibold text-primary underline">Open AI Findings</Link>}
    </>}
    <details className="rounded-md border border-outline-variant p-sm">
      <summary className="cursor-pointer text-label-md font-semibold text-on-surface">Advanced: {phase === 'prepare' ? 'configuration and setup details' : 'verification and troubleshooting'}</summary>
      <div className="mt-md min-w-0 space-y-md">
        {phase === 'prepare' ? <>
          <p className="text-body-sm">Use a terminal without recording or tracing. Never put a token in a command, file, screenshot or AI chat. The launcher starts your client and clears its session environment token when the client exits. Trusted processes on your account can access session environment variables.</p>
          <p className="break-all">Streamable HTTP endpoint: {setup.endpoint}</p>
          {config && <pre className="max-h-60 overflow-auto rounded-md bg-surface-container-low p-sm text-code-sm"><code>{config}</code></pre>}
          {launch && <pre className="max-h-60 overflow-auto rounded-md bg-surface-container-low p-sm text-code-sm"><code>{launch}</code></pre>}
          {client === 'generic' ? <p>Bind the Authorization header to <code>Bearer</code> followed by a space and a runtime secret. Suggested environment variable: <code className="break-all">{setup.envVar}</code>. Substitution syntax depends on your client; never replace it with a saved literal token.</p> : <a href={clientDocs[client]} target="_blank" rel="noreferrer" className="text-primary underline">Official client setup reference</a>}
        </> : <>
          <CopyInstruction label="verification prompt" text={prompt} />
          <p className="break-words text-body-sm">{prompt}</p>
          <ul className="space-y-sm">{mcpTools.map(tool => <li key={tool.name}><code className="break-all text-code-sm text-primary">{tool.name}</code><p className="text-body-sm">{tool.description}</p></li>)}</ul>
          <dl className="space-y-sm text-body-sm">
            <div><dt className="font-semibold">401 / Unauthorized</dt><dd>Check the client inherited its token. Ask the Owner to check expiry, revocation, membership and project access. Browser login and Supabase API keys are not MCP tokens.</dd></div>
            <div><dt className="font-semibold">403 / Host or Origin rejected</dt><dd>Use the exact endpoint and a supported remote MCP client. Do not broaden security headers.</dd></div>
            <div><dt className="font-semibold">Server missing or tools unavailable</dt><dd>Check configuration, workspace trust and client version. Restart from the secure launcher. Older allowlists must include finding submission. Claude Code requires documented environment expansion.</dd></div>
            <div><dt className="font-semibold">Finding retry</dt><dd>Reuse the same submission_id and identical payload after an uncertain response; use a new ID for a different finding.</dd></div>
          </dl>
          <p className="text-body-sm">Share only client version, server name, status and connection ID when requesting help. Never share tokens, headers or authentication logs. Exclude secrets and personal data from findings.</p>
        </>}
      </div>
    </details>
  </div>
}

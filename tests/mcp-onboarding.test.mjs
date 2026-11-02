import './tsx-loader.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { mcpSetup, clientConfig, clientLaunch, connectionStatus, connectionFields, issueConnectionToken, watchTokenReveal, mcpTools } from '../src/lib/mcpOnboarding.ts'

const { default: McpSetupGuide } = await import('../src/components/McpSetupGuide.tsx')
const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CONNECTION = '44444444-4444-4444-8444-444444444444'
const TOKEN = 'tqm_' + 'a'.repeat(64) // Synthetic; never a live credential.
const setup = mcpSetup('https://project.supabase.co', PROJECT)
const scope = { projectId: PROJECT, userId: USER, isOwner: true, enabled: true, archived: false, memberIds: [USER] }

test('endpoint and identifiers come from the configured backend and exact project UUID', () => {
  assert.equal(setup.endpoint, 'https://project.supabase.co/functions/v1/trackqa-mcp')
  assert.equal(setup.serverName, 'trackqa_11111111111141118111111111111111')
  assert.equal(setup.envVar, 'TRACKQA_MCP_11111111111141118111111111111111_TOKEN')
  assert.notEqual(mcpSetup('https://project.supabase.co', OTHER).envVar, setup.envVar)
})

for (const url of ['http://project.supabase.co', 'https://user:secret@project.supabase.co', 'https://project.supabase.co?token=secret', 'https://project.supabase.co#secret', 'https://project.supabase.co/path', 'not-a-url']) {
  test('unsafe endpoint rejected: ' + url.split(/[?#]/)[0], () => assert.throws(() => mcpSetup(url, PROJECT)))
}
test('project names and shell/config injection cannot be used as project identifiers', () => {
  for (const id of ['a project', TOKEN, PROJECT + '"\nmalicious=true', '$(unsafe)']) assert.throws(() => mcpSetup('https://project.supabase.co', id))
})

test('Codex config uses documented HTTP bearer environment binding and all five tools', () => {
  const config = clientConfig(setup, 'codex')
  assert.equal(config, `[mcp_servers.${setup.serverName}]\nurl = "${setup.endpoint}"\nbearer_token_env_var = "${setup.envVar}"\nenabled_tools = [${mcpTools.map(t => JSON.stringify(t.name)).join(', ')}]`)
  assert.equal(mcpTools.length, 5)
  assert.ok(config.includes('trackqa_submit_finding'))
  assert.doesNotMatch(config, /http_headers|Authorization|tqm_|required\s*=/)
})

test('Claude JSON parses and preserves a literal env reference instead of a resolved secret', () => {
  const value = JSON.parse(clientConfig(setup, 'claude'))
  assert.deepEqual(value.mcpServers[setup.serverName], { type: 'http', url: setup.endpoint, headers: { Authorization: 'Bearer ${' + setup.envVar + '}' } })
  assert.ok(!JSON.stringify(value).includes(TOKEN))
  assert.equal(clientConfig(setup, 'generic'), null)
})

test('configuration and launch builders refuse tampered scope and unsupported clients', () => {
  for (const change of [{ envVar: 'X; unsafe' }, { serverName: 'x]\nmalicious' }, { endpoint: 'https://other.test/mcp' }]) {
    assert.throws(() => clientConfig({ ...setup, ...change }, 'codex'))
    assert.throws(() => clientLaunch({ ...setup, ...change }, 'codex', 'bash'))
  }
  assert.throws(() => clientConfig(setup, 'unsupported'))
  assert.throws(() => clientLaunch(setup, 'generic', 'bash'))
})

test('an accidentally attached token field can never enter a generated configuration or launch script', () => {
  const accidental = { ...setup, token: TOKEN, access_token: TOKEN }
  for (const client of ['codex', 'claude']) {
    assert.ok(!clientConfig(accidental, client).includes(TOKEN))
    for (const terminal of ['powershell', 'bash']) assert.ok(!clientLaunch(accidental, client, terminal).includes(TOKEN))
  }
})

for (const client of ['codex', 'claude']) test(`${client} launchers keep token entry out of argv/history and clear session environment`, () => {
  const powershell = clientLaunch(setup, client, 'powershell')
  assert.match(powershell, /Read-Host 'TrackQA token \(hidden\)' -AsSecureString/)
  assert.match(powershell, /finally \{/)
  assert.ok(powershell.includes('Remove-Item Env:' + setup.envVar))
  assert.match(powershell, /ZeroFreeBSTR/)
  const bash = clientLaunch(setup, client, 'bash')
  assert.match(bash, /set \+x/)
  assert.match(bash, /read -r -s -p/)
  assert.ok(bash.includes(`trap 'unset ${setup.envVar}' EXIT`))
  for (const script of [bash, powershell]) {
    assert.ok(script.split('\n').some(line => line.trim() === client), 'client receives no credential argument')
    assert.ok(!script.includes(TOKEN))
    assert.doesNotMatch(script, /--header|--token|SetEnvironmentVariable|Write-Host|console\.log|setx|Out-File|WriteAllText/)
  }
})

test('issuance invokes only the existing RPC once and returns metadata, with the SDK token response cleared', async () => {
  const rows = [{ connection_id: CONNECTION, access_token: TOKEN }]
  const calls = []
  const revealed = []
  const result = await issueConnectionToken(async args => { calls.push(args); return { data: rows, error: null } }, scope, '  Work laptop  ', value => { revealed.push(value); return true })
  assert.deepEqual(calls, [{ p_project_id: PROJECT, p_user_id: USER, p_client_label: 'Work laptop' }])
  assert.deepEqual(revealed, [{ connectionId: CONNECTION, token: TOKEN }])
  assert.deepEqual(result, { connectionId: CONNECTION, displayed: true })
  assert.equal(rows[0].access_token, '')
  assert.ok(!JSON.stringify(result).includes(TOKEN))
})

for (const change of [{ isOwner: false }, { enabled: false }, { archived: true }, { memberIds: [] }, { projectId: 'invalid' }]) {
  test('invalid issuance scope cannot reach the RPC: ' + Object.keys(change).join('/'), async () => {
    let calls = 0
    await assert.rejects(issueConnectionToken(async () => { calls++; return { data: null, error: null } }, { ...scope, ...change }, 'Laptop', () => true))
    assert.equal(calls, 0)
  })
}
test('invalid labels cannot reach the issuance RPC', async () => {
  for (const label of ['', '   ', 'x'.repeat(121)]) {
    let called = false
    await assert.rejects(issueConnectionToken(async () => { called = true; return { data: null, error: null } }, scope, label, () => true))
    assert.equal(called, false)
  }
})
test('transport and malformed-result failures do not retry, expose server diagnostics or reveal a token', async () => {
  for (const response of [null, [], [{ connection_id: 'invalid', access_token: TOKEN }], [{ connection_id: CONNECTION, access_token: 'invalid' }]]) {
    let calls = 0
    await assert.rejects(issueConnectionToken(async () => { calls++; return { data: response, error: null } }, scope, 'Laptop', () => { throw new Error('Must not reveal') }), error => !error.message.includes(TOKEN))
    assert.equal(calls, 1)
    if (response?.length) assert.equal(response[0].access_token, '')
  }
  let calls = 0
  await assert.rejects(issueConnectionToken(async () => { calls++; throw new Error(TOKEN) }, scope, 'Laptop', () => true), error => !error.message.includes(TOKEN))
  assert.equal(calls, 1)
  await assert.rejects(issueConnectionToken(async () => ({ data: null, error: { message: TOKEN } }), scope, 'Laptop', () => true), error => !error.message.includes(TOKEN))
})
test('dismissed/stale handoff returns only the connection ID and discards the response token', async () => {
  const rows = [{ connection_id: CONNECTION, access_token: TOKEN }]
  assert.deepEqual(await issueConnectionToken(async () => ({ data: rows, error: null }), scope, 'Laptop', () => false), { connectionId: CONNECTION, displayed: false })
  assert.equal(rows[0].access_token, '')
})
test('a reveal callback error cannot expose a token through the error or SDK response', async () => {
  const rows = [{ connection_id: CONNECTION, access_token: TOKEN }]
  await assert.rejects(issueConnectionToken(async () => ({ data: rows, error: null }), scope, 'Laptop', () => { throw new Error(TOKEN) }), error => !error.message.includes(TOKEN))
  assert.equal(rows[0].access_token, '')
})

test('one-time reveal is dismissed on page hide, tab hiding and timeout; unmount removes handlers and timer', () => {
  const documentTarget = new EventTarget()
  documentTarget.hidden = false
  const windowTarget = new EventTarget()
  let timer, cancelled = false, cleared = 0
  windowTarget.setTimeout = (callback, ms) => { assert.equal(ms, 120000); timer = callback; return 1 }
  windowTarget.clearTimeout = id => { assert.equal(id, 1); cancelled = true }
  const dispose = watchTokenReveal(() => { cleared++ }, documentTarget, windowTarget)
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  assert.equal(cleared, 0)
  documentTarget.hidden = true
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  assert.equal(cleared, 1)
  windowTarget.dispatchEvent(new Event('pagehide'))
  assert.equal(cleared, 2)
  timer()
  assert.equal(cleared, 3)
  dispose()
  assert.equal(cancelled, true)
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  windowTarget.dispatchEvent(new Event('pagehide'))
  assert.equal(cleared, 3)
})

test('metadata projection and status do not contain credentials or claim a live IDE connection', () => {
  assert.doesNotMatch(connectionFields, /token_hash|access_token/)
  const connection = { user_id: USER, approved_by: USER, revoked_at: null, token_expires_at: '2030-01-01T00:00:00Z' }
  const now = Date.parse('2026-11-02T00:00:00Z')
  assert.equal(connectionStatus(connection, true, false, true, now), 'Ready to connect')
  assert.equal(connectionStatus(connection, false, false, true, now), 'Project disabled')
  assert.equal(connectionStatus(connection, true, true, true, now), 'Project archived')
  assert.equal(connectionStatus(connection, true, false, false, now), 'Unavailable')
  assert.equal(connectionStatus({ ...connection, approved_by: null }, true, false, true, now), 'Unavailable')
  assert.equal(connectionStatus({ ...connection, token_expires_at: '2020-01-01' }, true, false, true, now), 'Expired')
  assert.equal(connectionStatus({ ...connection, revoked_at: '2026-11-01' }, false, false, true, now), 'Revoked')
})

test('setup keeps raw configuration and launcher inside collapsed Advanced details', () => {
  for (const client of ['codex', 'claude', 'generic']) {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(McpSetupGuide, { setup, client, phase: 'prepare' })))
    assert.match(html, /<details[^>]*><summary/)
    assert.doesNotMatch(html, /<details[^>]*open/)
    assert.ok(html.indexOf(setup.endpoint) > html.indexOf('<details'))
    assert.ok(!html.includes(TOKEN))
    if (client !== 'generic') {
      assert.ok(html.indexOf('Read-Host') > html.indexOf('<details'))
      assert.match(html, /Copy configuration/)
      assert.match(html, /Copy secure launcher/)
    }
    assert.match(html, /cannot configure your local IDE/)
  }
})
test('verification explains human review and does not claim an observed connection', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(McpSetupGuide, {
    setup, client: 'codex', phase: 'verify', canReview: true,
  })))
  assert.match(html, /Pending Review/)
  assert.match(html, /href="\/ai-findings"/)
  assert.match(html, /cannot detect a live IDE connection/)
  assert.ok(html.indexOf('trackqa_submit_finding') > html.indexOf('<details'))
  assert.doesNotMatch(html, /<details[^>]*open/)
})
test('non-reviewers get guidance without a review link', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(McpSetupGuide, { setup, client: 'generic', phase: 'verify' })))
  assert.doesNotMatch(html, /href="\/ai-findings"/)
  assert.match(html, /human QA\/Owner/)
})

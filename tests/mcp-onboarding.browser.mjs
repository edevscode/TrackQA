// Local rendered regression checks. All backend traffic is mocked; no hosted calls.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Use an existing PLAYWRIGHT_MODULE; do not install dependencies.')
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const origin = process.env.MCP_UI_ORIGIN || 'http://127.0.0.1:4173'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '33333333-3333-4333-8333-333333333333'
const CONNECTION = '44444444-4444-4444-8444-444444444444'
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true }) })
after(async () => { await browser?.close() })

function connection(change = {}) {
  return { id: CONNECTION, project_id: PROJECT, user_id: USER, approved_by: USER, client_label: 'Synthetic Codex', token_expires_at: '2030-01-01', created_at: '2026-01-01', updated_at: '2026-01-01', revoked_at: null, ...change }
}

async function fixture(t, options = {}) {
  const { role = 'OWNER', enabled = false, width = 1280, archived = false, connections = [], verifyMode = 'confirmed', failRevoke = false, failEnable = false, failLoad = false, delayLoad = 0, lookupDelay = 0, ignoreFilters = false } = options
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  t.after(() => context.close())
  await context.routeWebSocket('**/*', socket => socket.close())
  const state = { enabled, connections, verifyMode, failLoad, revoked: 0, mutations: [], lookups: [], listQueries: [], unexpected: [], errors: [] }
  const project = () => ({ id: PROJECT, name: 'Synthetic onboarding', key: 'MOCK', owner_id: archived ? '55555555-5555-4555-8555-555555555555' : USER, description: '', archived, mcp_enabled: state.enabled, created_at: '2026-01-01', updated_at: '2026-01-01', timezone: 'UTC', issue_seq: 0 })
  const headers = { 'access-control-allow-origin': origin }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    if (url.origin === origin) return route.continue()
    if (url.hostname !== 'mzeuimqfrswrwoaqjdmp.supabase.co') return route.abort()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    let data = []
    if (method === 'HEAD') return route.fulfill({ status: 200, body: '', headers: { ...headers, 'content-range': '*/0', 'access-control-expose-headers': 'content-range' } })
    if (method === 'PATCH' && url.pathname.endsWith('/projects')) {
      state.mutations.push('projects')
      assert.equal(role, 'OWNER')
      assert.equal(archived, false)
      assert.equal(url.searchParams.get('id'), 'eq.' + PROJECT)
      assert.deepEqual(Object.keys(request.postDataJSON()), ['mcp_enabled'])
      if (failEnable) return route.fulfill({ status: 500, json: { message: 'Synthetic private error' }, headers })
      state.enabled = request.postDataJSON().mcp_enabled
      data = { id: PROJECT, mcp_enabled: state.enabled }
    } else if (method === 'POST' && url.pathname.endsWith('/revoke_mcp_connection')) {
      state.mutations.push('revoke_mcp_connection')
      state.revoked++
      assert.equal(role, 'OWNER')
      const id = request.postDataJSON().p_connection_id
      assert.deepEqual(Object.keys(request.postDataJSON()), ['p_connection_id'])
      if (failRevoke) return route.fulfill({ status: 500, json: { message: 'Synthetic private error' }, headers })
      const row = state.connections.find(row => row.id === id)
      assert.ok(row)
      row.revoked_at = '2026-01-02'
      data = null
    } else if (method !== 'GET') {
      state.unexpected.push(url.pathname)
      return route.abort()
    } else if (url.pathname === '/auth/v1/user') data = { id: USER, email: 'owner@example.invalid' }
    else if (url.pathname.endsWith('/profiles')) data = { id: USER, email: 'owner@example.invalid', full_name: 'Synthetic Owner', avatar_url: null }
    else if (url.pathname.endsWith('/project_members')) data = url.searchParams.get('select')?.includes('project:projects')
      ? [{ project_id: PROJECT, role, project: project() }]
      : [{ user_id: USER, role, profiles: { full_name: 'Synthetic Owner', email: 'owner@example.invalid', avatar_url: null } }]
    else if (url.pathname.endsWith('/projects')) data = project()
    else if (url.pathname.endsWith('/notification_preferences')) data = null
    else if (url.pathname.endsWith('/mcp_connections')) {
      const id = url.searchParams.get('id')
      if (id) {
        state.lookups.push({ id, project: url.searchParams.get('project_id'), select: url.searchParams.get('select') })
        if (lookupDelay) await new Promise(resolve => setTimeout(resolve, lookupDelay))
        if (state.verifyMode === 'error') return route.fulfill({ status: 500, json: { message: 'Synthetic private verification error' }, headers })
        data = state.connections.filter(row => 'eq.' + row.id === id).map(row => state.verifyMode === 'unrevoked' ? { ...row, revoked_at: null } : row)
        if (state.verifyMode === 'missing') data = []
        if (state.verifyMode === 'foreign') data = data.map(row => ({ ...row, project_id: '22222222-2222-4222-8222-222222222222' }))
        data = data[0] ?? null
      } else {
        state.listQueries.push(Object.fromEntries(url.searchParams))
        if (delayLoad) await new Promise(resolve => setTimeout(resolve, delayLoad))
        if (state.failLoad) return route.fulfill({ status: 500, json: { message: 'Synthetic private load error' }, headers })
        let rows = state.connections
        if (!ignoreFilters) {
          assert.equal(url.searchParams.get('revoked_at'), 'is.null')
          assert.match(url.searchParams.get('token_expires_at'), /^gt\./)
          rows = rows.filter(row => row.revoked_at === null && row.user_id && row.approved_by && Date.parse(row.token_expires_at) > Date.parse(url.searchParams.get('token_expires_at').slice(3)))
        }
        const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 11)
        data = rows.slice(offset, offset + limit)
      }
    }
    return route.fulfill({ json: data, headers })
  })
  await context.addInitScript(({ USER, PROJECT }) => {
    localStorage.setItem('sb-mzeuimqfrswrwoaqjdmp-auth-token', JSON.stringify({ access_token: 'synthetic-auth-fixture', refresh_token: 'synthetic-refresh-fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated' } }))
    localStorage.setItem('trackqa:currentProjectId', PROJECT)
    window.__copies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copies.push(value) } } })
  }, { USER, PROJECT })
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => state.errors.push(error.message))
  await page.goto(origin + (archived ? '/projects/archived' : '/project-settings'))
  if (archived) await page.getByText('Manage Connections · MOCK', { exact: true }).click()
  const panel = page.getByRole('heading', { name: archived ? 'Synthetic onboarding · Connections' : 'AI Integrations', exact: true }).locator('xpath=ancestor::section[1]')
  await panel.waitFor()
  if (!delayLoad) await panel.getByText('Loading connections…', { exact: true }).waitFor({ state: 'hidden' })
  t.after(() => {
    assert.deepEqual(state.unexpected, [], 'No issuance or unrelated mutation can be invoked')
    assert.deepEqual(state.errors, [], 'No page runtime errors')
  })
  return { page, panel, state }
}

async function revoke(page) {
  await page.getByRole('button', { name: 'Revoke', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke connection', exact: true }).click()
}

test('minimal page has access switch, short instruction and simple empty state when disabled', async t => {
  const { panel, state } = await fixture(t)
  assert.equal(await panel.getByRole('switch', { name: 'Project MCP access' }).isChecked(), false)
  assert.equal(await panel.getByText('Disabled', { exact: true }).count(), 1)
  assert.equal(await panel.getByText('No active connections.', { exact: true }).count(), 1)
  assert.equal(await panel.locator('details, [role="dialog"], input[type="text"], input[type="password"]').count(), 0)
  assert.doesNotMatch(await panel.textContent(), /Requirements|supported clients|Advanced|Manual Setup|TRACKQA_PUBLIC_KEY|VITE_SUPABASE|Windows|Node\.js|5173|MFA|Google|90 days|Expires|recovery|disconnect|experimental|connection ID/i)
  assert.deepEqual(state.mutations, [])
})

test('Owner access toggle requires confirmation and verifies the returned project state', async t => {
  const { page, panel, state } = await fixture(t)
  await panel.getByRole('switch').locator('..').click()
  assert.equal(state.enabled, false)
  await page.getByRole('dialog').getByRole('button', { name: 'Enable project access', exact: true }).click()
  await panel.getByText('Enabled', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('switch').isChecked(), true)
  await panel.getByRole('switch').locator('..').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Disable project access', exact: true }).click()
  await panel.getByText('Disabled', { exact: true }).waitFor()
  assert.deepEqual(state.mutations, ['projects', 'projects'])
})

test('failed access update stays disabled and does not expose diagnostics or retry', async t => {
  const { page, panel, state } = await fixture(t, { failEnable: true })
  await panel.getByRole('switch').locator('..').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Enable project access', exact: true }).click()
  await panel.getByRole('alert').waitFor()
  assert.equal(await panel.getByRole('switch').isChecked(), false)
  assert.doesNotMatch(await panel.innerText(), /Synthetic private/)
  assert.deepEqual(state.mutations, ['projects'])
})

for (const role of ['DEVELOPER', 'QA']) test(role + ' cannot toggle access or revoke', async t => {
  const { panel, state } = await fixture(t, { role, enabled: true, connections: [connection()] })
  assert.equal(await panel.getByRole('switch').isDisabled(), true)
  assert.equal(await panel.getByRole('button', { name: 'Revoke', exact: true }).count(), 0)
  assert.deepEqual(state.mutations, [])
})

test('active connections exclude revoked and expired history even if a response contains it', async t => {
  const { panel, state } = await fixture(t, { enabled: true, ignoreFilters: true, connections: [connection(), connection({ id: '55555555-5555-4555-8555-555555555555', client_label: 'Revoked history', revoked_at: '2026-01-02' }), connection({ id: '66666666-6666-4666-8666-666666666666', client_label: 'Expired history', token_expires_at: '2020-01-01' })] })
  await panel.getByText('Synthetic Codex', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Revoke', exact: true }).count(), 1)
  assert.doesNotMatch(await panel.textContent(), /Revoked history|Expired history|Expires|Advanced|44444444/)
  assert.equal(await panel.getByText('Ready to connect', { exact: true }).count(), 1)
  assert.equal(state.listQueries[0].project_id, 'eq.' + PROJECT)
})

test('project-disabled grants remain revocable without claiming live connectivity', async t => {
  const { panel } = await fixture(t, { connections: [connection()] })
  assert.equal(await panel.getByText('Project disabled', { exact: true }).count(), 1)
  assert.equal(await panel.getByRole('button', { name: 'Revoke', exact: true }).count(), 1)
  assert.equal(await panel.getByText('Ready to connect', { exact: true }).count(), 0)
})

test('revocation success waits for the exact project-scoped verification lookup', async t => {
  const { page, panel, state } = await fixture(t, { connections: [connection()], lookupDelay: 500 })
  await revoke(page)
  assert.equal(await panel.getByText('Connection revoked.', { exact: true }).count(), 0)
  await panel.getByText('Connection revoked.', { exact: true }).waitFor()
  await panel.getByText('No active connections.', { exact: true }).waitFor()
  assert.deepEqual(state.lookups, [{ id: 'eq.' + CONNECTION, project: 'eq.' + PROJECT, select: 'id,project_id,revoked_at' }])
  assert.equal(state.revoked, 1)
})

for (const verifyMode of ['error', 'missing', 'unrevoked', 'foreign']) test('uncertain revocation (' + verifyMode + ') rechecks without repeating the mutation', async t => {
  const { page, panel, state } = await fixture(t, { connections: [connection()], verifyMode })
  await revoke(page)
  await panel.getByText('Revocation not yet verified.', { exact: true }).waitFor()
  assert.equal(await panel.getByText('Connection revoked.', { exact: true }).count(), 0)
  state.verifyMode = 'confirmed'
  await panel.getByRole('button', { name: 'Check revocation', exact: true }).click()
  await panel.getByText('Connection revoked.', { exact: true }).waitFor()
  assert.equal(state.revoked, 1)
})

test('failed revoke offers verification without claiming success or automatic retry', async t => {
  const { page, panel, state } = await fixture(t, { connections: [connection()], failRevoke: true })
  await revoke(page)
  await panel.getByText('Could not confirm revocation.', { exact: true }).waitFor()
  assert.equal(state.revoked, 1)
  assert.equal(state.lookups.length, 0)
  await panel.getByRole('button', { name: 'Check revocation', exact: true }).click()
  await panel.getByText('Revocation not yet verified.', { exact: true }).waitFor()
  assert.equal(state.revoked, 1)
})

test('archived Owner manages connections without setup, access changes or restoration', async t => {
  const { page, panel, state } = await fixture(t, { archived: true, enabled: true, connections: [connection()] })
  assert.equal(await panel.getByRole('switch').count(), 0)
  assert.equal(await panel.getByRole('button', { name: 'Generate connection' }).count(), 0)
  await panel.getByText('Project archived', { exact: true }).waitFor()
  await revoke(page)
  await panel.getByText('Connection revoked.', { exact: true }).waitFor()
  assert.deepEqual(state.mutations, ['revoke_mcp_connection'])
  assert.equal(state.enabled, true)
})

test('archived non-Owner cannot revoke or access setup', async t => {
  const { panel, state } = await fixture(t, { archived: true, role: 'DEVELOPER' })
  await panel.getByText('No active connections.', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('switch').count(), 0)
  assert.equal(await panel.getByRole('button').count(), 0)
  assert.deepEqual(state.mutations, [])
})

test('loading and error states disable privileged controls and support a read-only retry', async t => {
  const loading = await fixture(t, { delayLoad: 1000 })
  assert.equal(await loading.panel.getByRole('switch').isDisabled(), true)
  await loading.panel.getByText('No active connections.', { exact: true }).waitFor()
  const failed = await fixture(t, { failLoad: true })
  await failed.panel.getByRole('alert').waitFor()
  assert.equal(await failed.panel.getByRole('switch').isDisabled(), true)
  assert.equal(await failed.panel.getByText('No active connections.', { exact: true }).count(), 0)
  failed.state.failLoad = false
  await failed.panel.getByRole('button', { name: 'Retry', exact: true }).click()
  await failed.panel.getByText('No active connections.', { exact: true }).waitFor()
  assert.deepEqual(failed.state.mutations, [])
})

test('pagination applies only to active connections', async t => {
  const rows = Array.from({ length: 11 }, (_, i) => connection({ id: '77777777-7777-4777-8777-' + String(i).padStart(12, '0'), client_label: 'Client ' + (i + 1) }))
  const { panel, state } = await fixture(t, { connections: rows })
  assert.equal(await panel.getByRole('button', { name: 'Revoke', exact: true }).count(), 10)
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await panel.getByText('Client 11', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Revoke', exact: true }).count(), 1)
  assert.equal(state.listQueries.at(-1).offset, '10')
})

test('actual minimal desktop and mobile panels fit, with obsolete UI absent from the DOM', async t => {
  for (const width of [375, 1280]) {
    const { panel } = await fixture(t, { width, enabled: true, connections: [connection({ client_label: 'Synthetic client with a longer connection name' })] })
    assert.equal(await panel.locator('details').count(), 0)
    assert.doesNotMatch(await panel.textContent(), /Requirements|Advanced|Manual|TRACKQA_PUBLIC_KEY|Windows|MFA|Expires|recovery|disconnect|experimental|connection ID/i)
    assert.equal(await panel.evaluate(e => e.scrollWidth <= e.clientWidth), true)
    await panel.scrollIntoViewIfNeeded()
    if (process.env.MCP_UI_SCREENSHOTS) await panel.screenshot({ path: path.join(process.env.MCP_UI_SCREENSHOTS, 'minimal-' + width + '.png') })
    const archived = await fixture(t, { width, archived: true, connections: [connection()] })
    assert.equal(await archived.panel.evaluate(e => e.scrollWidth <= e.clientWidth), true)
  }
})

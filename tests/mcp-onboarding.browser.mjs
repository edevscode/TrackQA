// Local browser regression checks. Uses an existing Playwright installation; no hosted calls.
// Start Vite preview on 127.0.0.1:4173, set PLAYWRIGHT_MODULE to its existing module, then run this file.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const modulePath = process.env.PLAYWRIGHT_MODULE
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an existing Playwright module; do not install dependencies.')
const { chromium } = await import(pathToFileURL(modulePath).href)
const origin = 'http://127.0.0.1:4173'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '33333333-3333-4333-8333-333333333333'
const CONNECTION = '44444444-4444-4444-8444-444444444444'
const TOKEN = 'tqm_' + 'a'.repeat(64) // Synthetic fixture only.
let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true }) })
after(async () => { await browser?.close() })

function syntheticConnection() {
  return { id: CONNECTION, project_id: PROJECT, user_id: USER, approved_by: USER, client_label: 'Synthetic device', token_expires_at: '2030-01-01', created_at: '2026-01-01', updated_at: '2026-01-01', revoked_at: null }
}

async function fixture(t, { role = 'OWNER', enabled = false, failIssue = false, width = 1280, archived = false, connections = [], verifyMode = 'confirmed', failRevoke = false, failLoad = false, delayLoad = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  t.after(() => context.close())
  context.setDefaultTimeout(7000)
  await context.routeWebSocket('**/*', socket => socket.close())
  const state = { enabled, issued: 0, revoked: 0, connections, mutations: [], lookups: [], verifyMode }
  // Owner membership, not the project's original creator, grants revocation.
  const project = () => ({ id: PROJECT, name: 'Synthetic onboarding', key: 'MOCK', owner_id: archived ? '55555555-5555-4555-8555-555555555555' : USER, description: '', archived, mcp_enabled: state.enabled, created_at: '2026-01-01', updated_at: '2026-01-01', timezone: 'UTC', issue_seq: 0 })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    // Deny all external traffic except fully mocked Supabase responses.
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    let data = []
    if (request.method() !== 'GET' && /\/(projects|issue_mcp_connection_token|revoke_mcp_connection)$/.test(url.pathname)) state.mutations.push(url.pathname.split('/').pop())
    if (url.pathname === '/auth/v1/user') data = { id: USER, email: 'owner@example.invalid' }
    else if (url.pathname.endsWith('/profiles')) data = { id: USER, email: 'owner@example.invalid', full_name: 'Synthetic Owner', avatar_url: null }
    else if (url.pathname.endsWith('/project_members')) data = url.searchParams.get('select')?.includes('project:projects')
      ? [{ project_id: PROJECT, role, project: project() }]
      : [{ user_id: USER, role, profiles: { full_name: 'Synthetic Owner', email: 'owner@example.invalid', avatar_url: null } }]
    else if (url.pathname.endsWith('/projects')) {
      if (request.method() === 'PATCH') state.enabled = request.postDataJSON().mcp_enabled
      data = project()
    } else if (url.pathname.endsWith('/mcp_connections')) {
      if (delayLoad) await new Promise(resolve => setTimeout(resolve, delayLoad))
      const id = url.searchParams.get('id')
      if (id) {
        state.lookups.push({ id, project: url.searchParams.get('project_id'), select: url.searchParams.get('select') })
        if (state.verifyMode === 'error') return route.fulfill({ status: 500, json: { message: 'Synthetic verification failure' }, headers: { 'access-control-allow-origin': origin } })
        data = state.connections.filter(row => `eq.${row.id}` === id).map(row => state.verifyMode === 'unrevoked' ? { ...row, revoked_at: null } : row)
        if (state.verifyMode === 'missing') data = []
        if (state.verifyMode === 'foreign') data = data.map(row => ({ ...row, project_id: '22222222-2222-4222-8222-222222222222' }))
      } else {
        if (failLoad) return route.fulfill({ status: 500, json: { message: 'Synthetic load failure' }, headers: { 'access-control-allow-origin': origin } })
        data = state.connections
      }
    }
    else if (url.pathname.endsWith('/issue_mcp_connection_token')) {
      assert.equal(role, 'OWNER')
      assert.equal(state.enabled, true)
      state.issued++
      if (failIssue) return route.fulfill({ status: 500, json: { message: 'Synthetic failure; never show raw diagnostics' }, headers: { 'access-control-allow-origin': origin } })
      const args = request.postDataJSON()
      assert.equal(args.p_project_id, PROJECT)
      assert.equal(args.p_user_id, USER)
      state.connections.push({ id: CONNECTION, project_id: PROJECT, user_id: USER, approved_by: USER, client_label: args.p_client_label, token_expires_at: '2030-01-01', created_at: '2026-01-01', updated_at: '2026-01-01', revoked_at: null })
      data = [{ connection_id: CONNECTION, access_token: TOKEN }]
    } else if (url.pathname.endsWith('/revoke_mcp_connection')) {
      assert.equal(role, 'OWNER')
      state.revoked++
      if (failRevoke) return route.fulfill({ status: 500, json: { message: 'Synthetic revoke failure' }, headers: { 'access-control-allow-origin': origin } })
      state.connections[0].revoked_at = '2026-01-02'
      data = null
    }
    await route.fulfill({ json: data, headers: { 'access-control-allow-origin': origin } })
  })
  await context.addInitScript(({ USER, PROJECT }) => {
    localStorage.setItem('sb-mzeuimqfrswrwoaqjdmp-auth-token', JSON.stringify({ access_token: 'synthetic-auth-fixture', refresh_token: 'synthetic-refresh-fixture', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: USER, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated' } }))
    localStorage.setItem('trackqa:currentProjectId', PROJECT)
    window.__copies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copies.push(value) } } })
  }, { USER, PROJECT })
  const page = await context.newPage()
  await page.goto(`${origin}/${archived ? 'projects/archived' : 'project-settings'}`)
  if (archived) await page.getByText('Manage Connections · MOCK', { exact: true }).click()
  else await page.getByRole('heading', { name: 'AI Integrations', exact: true }).waitFor()
  if (!failLoad && !delayLoad) await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Refresh integration status' && !button.disabled))
  return { page, state }
}
async function prepare(page, client = 'Codex CLI') {
  const advanced = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Advanced \/ Manual Setup$/ }) })
  if (!await advanced.evaluate(element => element.open)) await advanced.locator('summary').click()
  await page.getByRole('button', { name: 'Open manual setup', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: new RegExp(client) }).check()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  return dialog
}
async function issue(page, dialog, state) {
  if (!state.enabled) await dialog.getByRole('button', { name: 'Enable project access', exact: true }).click()
  await dialog.getByRole('button', { name: 'Approve & show token' }).waitFor()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Approve & show token' }).click()
  await dialog.getByRole('textbox', { name: 'One-time MCP token' }).waitFor()
}

test('minimal overview, client selection, Back navigation and collapsed technical details', async t => {
  const { page, state } = await fixture(t)
  assert.equal(await page.locator('pre:visible').count(), 1)
  await page.getByRole('button', { name: 'Copy connector command', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__copies.pop()), 'npx trackqa connect')
  assert.equal(state.mutations.length, 0)
  assert.equal(await page.getByText('Manage Connections', { exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Revoke', exact: true }).count(), 0)
  const dialog = await prepare(page, 'Claude Code')
  assert.equal(await dialog.locator('pre:visible').count(), 0)
  await dialog.getByRole('button', { name: 'Copy configuration', exact: true }).click()
  let copies = await page.evaluate(() => window.__copies)
  assert.match(copies[0], /\$\{TRACKQA_MCP_/)
  assert.ok(!copies[0].includes(TOKEN))
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  assert.equal(await dialog.getByRole('radio', { name: 'Claude Code (experimental)' }).isChecked(), true)
  await dialog.getByRole('radio', { name: /Codex CLI/ }).check()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy configuration', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy secure launcher', exact: true }).click()
  copies = await page.evaluate(() => window.__copies)
  assert.match(copies[1], /bearer_token_env_var/)
  assert.match(copies[2], /Read-Host .* -AsSecureString/)
  assert.ok(copies.every(value => !value.includes(TOKEN)))
  assert.equal(state.issued, 0)
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByRole('radio', { name: /Other MCP client/ }).check()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy endpoint', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Copy secure launcher', exact: true }).count(), 0)
})

test('Owner approval issues once, copies only explicitly, discards token before verification and supports revocation', async t => {
  const { page, state } = await fixture(t)
  const dialog = await prepare(page)
  await dialog.getByRole('button', { name: 'Enable project access', exact: true }).click()
  await dialog.getByRole('button', { name: 'Approve & show token' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Approve & show token' }).isDisabled(), true)
  await issue(page, dialog, state)
  assert.equal(state.issued, 1)
  assert.equal(await page.evaluate(() => window.__copies.length), 0)
  await dialog.getByRole('button', { name: 'Copy token', exact: true }).click()
  assert.equal(await page.evaluate(token => window.__copies[0] === token, TOKEN), true)
  await dialog.getByRole('button', { name: 'Continue to verification' }).click()
  assert.equal(await dialog.getByRole('textbox', { name: 'One-time MCP token' }).count(), 0)
  await dialog.getByText('Verify in your client', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Back', exact: true }).count(), 0)
  assert.equal(await dialog.locator('code:visible').count(), 0)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  assert.equal(await page.getByText('Connected', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(token => JSON.stringify(localStorage).includes(token) || JSON.stringify(sessionStorage).includes(token) || location.href.includes(token), TOKEN), false)
  await page.getByText('Manage Connections', { exact: true }).click()
  await page.getByRole('button', { name: 'Revoke', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke connection', exact: true }).click()
  await page.getByText(/Connection revoked/).waitFor()
  assert.equal(state.revoked, 1)
})

test('closing the wizard removes its one-time token and reopening cannot reveal it again', async t => {
  const { page, state } = await fixture(t, { enabled: true })
  const dialog = await prepare(page)
  await issue(page, dialog, state)
  await dialog.getByRole('button', { name: 'Close setup' }).click()
  await prepare(page)
  assert.equal(await page.getByRole('textbox', { name: 'One-time MCP token' }).count(), 0)
  assert.equal(state.issued, 1)
})

test('tab hiding clears one-time display without implicitly revoking or issuing again', async t => {
  const { page, state } = await fixture(t, { enabled: true })
  const dialog = await prepare(page)
  await issue(page, dialog, state)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await dialog.getByText(/The one-time display has ended/).waitFor({ state: 'attached' })
  assert.equal(await dialog.getByRole('textbox', { name: 'One-time MCP token' }).count(), 0)
  assert.equal(state.issued, 1)
  assert.equal(state.revoked, 0)
})

test('non-Owner cannot enable or issue; enabled access supports an externally Owner-issued token', async t => {
  const { page, state } = await fixture(t, { role: 'DEVELOPER', enabled: true })
  const dialog = await prepare(page)
  assert.equal(await dialog.getByRole('button', { name: /Approve & show|Enable project/ }).count(), 0)
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Continue with Owner-issued token' }).click()
  assert.equal(await dialog.getByRole('textbox').count(), 0)
  await dialog.getByRole('button', { name: 'Continue to verification' }).click()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByText('Manage Connections', { exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /Enable project access|Revoke/ }).count(), 0)
  assert.equal(state.mutations.length, 0)
})

test('non-Owner cannot proceed when project access is disabled', async t => {
  const { page, state } = await fixture(t, { role: 'QA' })
  const dialog = await prepare(page)
  await dialog.getByRole('checkbox').check()
  assert.equal(await dialog.getByRole('button', { name: 'Ask an Owner for access' }).isDisabled(), true)
  assert.equal(state.mutations.length, 0)
})

test('issuance failure stays in approval, reports a generic error and never retries automatically', async t => {
  const { page, state } = await fixture(t, { enabled: true, failIssue: true })
  const dialog = await prepare(page)
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Approve & show token' }).click()
  await dialog.getByRole('alert').waitFor()
  assert.match(await dialog.getByRole('alert').innerText(), /never automatically retried/)
  assert.doesNotMatch(await dialog.innerText(), /Synthetic failure/)
  assert.equal(state.issued, 1)
  assert.equal(await dialog.getByRole('textbox', { name: 'One-time MCP token' }).count(), 0)
})

test('mobile wizard fits the viewport and Escape restores focus to manual setup', async t => {
  const { page } = await fixture(t, { width: 375 })
  const dialog = await prepare(page)
  const bounds = await dialog.boundingBox()
  assert.ok(bounds.width >= 340, 'Mobile dialog must use the available width, not a spacing token')
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 376)
  assert.ok(bounds.height <= 900)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  if (process.env.ONBOARDING_SCREENSHOT) await page.screenshot({ path: process.env.ONBOARDING_SCREENSHOT })
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Open manual setup', exact: true }).evaluate(button => button === document.activeElement), true)
})

async function revoke(page) {
  const summary = page.getByText('Manage Connections', { exact: true })
  const management = summary.locator('..')
  if (!await management.evaluate(element => element.open)) await summary.click()
  await page.getByRole('button', { name: 'Revoke', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke connection', exact: true }).click()
}

test('revocation succeeds only after an exact project-scoped independent lookup', async t => {
  const { page, state } = await fixture(t, { connections: [syntheticConnection()] })
  await revoke(page)
  await page.getByText(/Connection revoked\. Server verification confirmed/).waitFor()
  assert.deepEqual(state.lookups, [{ id: `eq.${CONNECTION}`, project: `eq.${PROJECT}`, select: 'id,project_id,revoked_at' }])
  assert.equal(state.revoked, 1)
})

for (const verifyMode of ['error', 'missing', 'unrevoked', 'foreign']) test(`ambiguous revocation (${verifyMode}) offers read-only recheck without repeating mutation`, async t => {
  const { page, state } = await fixture(t, { connections: [syntheticConnection()], verifyMode })
  await revoke(page)
  await page.getByText(/Revocation verification is pending/).waitFor()
  await page.getByText(/Revocation unverified/).waitFor()
  assert.equal(await page.getByText(/Connection revoked\. Server verification confirmed/).count(), 0)
  assert.equal(state.revoked, 1)
  state.verifyMode = 'confirmed'
  await page.getByRole('button', { name: 'Check revocation', exact: true }).click()
  await page.getByText(/Connection revoked\. Server verification confirmed/).waitFor()
  assert.equal(state.revoked, 1)
})

test('failed revocation reports uncertainty without success or automatic retry', async t => {
  const { page, state } = await fixture(t, { connections: [syntheticConnection()], failRevoke: true })
  await revoke(page)
  await page.getByRole('alert').getByText(/Revocation could not be confirmed/).waitFor()
  assert.equal(await page.getByText(/Connection revoked\. Server verification confirmed/).count(), 0)
  assert.equal(state.revoked, 1)
  assert.equal(state.lookups.length, 0)
})

test('archived Owner can inspect and revoke without setup, enablement or restoration', async t => {
  const { page, state } = await fixture(t, { archived: true, enabled: true, connections: [syntheticConnection()] })
  assert.equal(await page.getByRole('button', { name: /Copy connector|Open manual|Enable project access|Disable project access/ }).count(), 0)
  await revoke(page)
  await page.getByText(/Server verification confirmed/).waitFor()
  assert.deepEqual(state.mutations, ['revoke_mcp_connection'])
  assert.equal(state.enabled, true)
  assert.equal(state.issued, 0)
  assert.match(page.url(), /projects\/archived$/)
})

test('archived non-Owner sees RLS-visible metadata only and cannot revoke', async t => {
  const { page, state } = await fixture(t, { archived: true, role: 'DEVELOPER' })
  await page.getByText(/No connections visible for your account/).waitFor()
  assert.equal(await page.getByRole('button', { name: /Revoke|Open manual|Enable project access|Disable project access/ }).count(), 0)
  assert.deepEqual(state.mutations, [])
})

test('integration loading, empty and error states do not claim connectivity or trigger mutation', async t => {
  const loading = await fixture(t, { delayLoad: 2500 })
  assert.equal(await loading.page.getByRole('button', { name: 'Open manual setup', exact: true, includeHidden: true }).isDisabled(), true)
  await loading.page.getByText(/No connections yet/).waitFor({ state: 'attached' })
  assert.deepEqual(loading.state.mutations, [])
  const failed = await fixture(t, { failLoad: true })
  await failed.page.getByRole('alert').getByText(/Unable to check integration access/).waitFor()
  assert.equal(await failed.page.getByRole('button', { name: 'Open manual setup', exact: true, includeHidden: true }).isDisabled(), true)
  assert.equal(await failed.page.getByText('Ready to connect', { exact: true }).count(), 0)
  assert.deepEqual(failed.state.mutations, [])
})

test('connector and archived management layouts fit mobile and desktop without opening manual setup', async t => {
  for (const width of [375, 1280]) {
    const { page, state } = await fixture(t, { width })
    assert.equal(await page.getByRole('button', { name: 'Copy connector command', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Open manual setup', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (process.env.MCP_UI_SCREENSHOTS) await page.getByRole('heading', { name: 'AI Integrations', exact: true }).locator('xpath=ancestor::section[1]').screenshot({ path: path.join(process.env.MCP_UI_SCREENSHOTS, `connector-${width}.png`) })
    assert.deepEqual(state.mutations, [])
    const archived = await fixture(t, { width, archived: true, connections: [syntheticConnection()] })
    // Check the changed panel; the pre-existing standalone archive header has
    // a separate narrow-screen overflow and is outside MCP integration scope.
    const panel = archived.page.getByRole('heading', { name: 'Synthetic onboarding · Connections', exact: true }).locator('xpath=ancestor::section[1]/..')
    const bounds = await panel.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
    assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    if (process.env.MCP_UI_SCREENSHOTS) await panel.screenshot({ path: path.join(process.env.MCP_UI_SCREENSHOTS, `archived-${width}.png`) })
    assert.deepEqual(archived.state.mutations, [])
  }
})

test('v0.1.1 hosted onboarding needs no manual public key; custom configuration stays advanced', async t => {
  for (const width of [375, 1280]) {
    const { page, state } = await fixture(t, { width })
    const overview = page.getByRole('heading', { name: 'AI Integrations', exact: true }).locator('xpath=ancestor::section[1]')
    assert.match(await overview.innerText(), /v0\.1\.1 or newer includes official hosted configuration/)
    assert.doesNotMatch(await overview.innerText(), /TRACKQA_PUBLIC_KEY|\$env:/)
    await page.getByText('Requirements, supported clients and disconnect', { exact: true }).click()
    assert.doesNotMatch(await overview.innerText(), /TRACKQA_PUBLIC_KEY|\$env:/)
    const custom = page.getByText('Advanced: custom deployments', { exact: true })
    assert.equal(await custom.locator('..').evaluate(element => element.open), false)
    await custom.click()
    assert.match(await custom.locator('..').innerText(), /TRACKQA_PUBLIC_KEY/)
    assert.match(await custom.locator('..').innerText(), /key override alone does not change the backend/)
    assert.deepEqual(state.mutations, [])
  }
})

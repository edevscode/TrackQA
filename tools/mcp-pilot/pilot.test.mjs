import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { BASE, SERVER, createStore, createHumanApi, disabledConfig, issue, cleanup } from './pilot.mjs'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const CONNECTION = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'tqm_' + 'a'.repeat(64) // Synthetic only; never a hosted credential.
const jwt = body => 'test.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.unsigned'
const AUTH = jwt({ role: 'authenticated', sub: USER })
const KEY = jwt({ role: 'anon' })

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trackqa-pilot-test-'))
  await fs.mkdir(path.join(root, '.agents'))
  t.after(async () => {
    // Only fixed files within this test's independently created directory.
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('trackqa-pilot-test-'))
    for (const name of ['.agents/mcp_config.json', 'pilot-state.json', 'pilot-state.json.next', '.gitignore']) await fs.unlink(path.join(root, name)).catch(e => { if(e.code !== 'ENOENT') throw e })
    await fs.rmdir(path.join(root, '.agents'))
    await fs.rmdir(root)
  })
  const store = createStore(root)
  await store.prepare()
  let connection = null
  const project = { id: PROJECT, name: 'MCP Synthetic Pilot', mcp_enabled: true, archived: false, ...options.project }
  const calls = []
  const api = async (route, method = 'GET', body) => {
    calls.push({ route, method, body })
    if (options.failAll) throw new Error('secret backend details ' + TOKEN)
    if (route === '/auth/v1/user') return { id: USER }
    if (route.includes('/project_members?')) return [{ role: options.role ?? 'OWNER' }]
    if (route === '/rest/v1/rpc/issue_mcp_connection_token') {
      assert.deepEqual(Object.keys(body).sort(), ['p_client_label','p_project_id','p_user_id'])
      assert.equal(body.p_project_id, PROJECT)
      assert.equal(body.p_user_id, USER)
      connection = { id: CONNECTION, revoked_at: null }
      if (options.lostResponse) throw new Error('lost response ' + TOKEN)
      return [{ connection_id: CONNECTION, access_token: options.invalidToken ? 'not-a-token' : TOKEN }]
    }
    if (route === '/rest/v1/rpc/revoke_mcp_connection') {
      if (options.failRevoke) throw new Error(TOKEN)
      assert.equal(body.p_connection_id, CONNECTION)
      if (!options.unverifiedRevoke) connection.revoked_at = '2026-11-01T00:00:00Z'
      return null
    }
    if (route.includes('/mcp_connections?')) return connection && !options.invisibleConnection ? [{ ...connection }] : []
    if (route.includes('/projects?') && method === 'PATCH') {
      if (options.failDisable) throw new Error(TOKEN)
      assert.deepEqual(body, { mcp_enabled: false })
      if (!options.unverifiedDisable) project.mcp_enabled = false
      return [{ ...project }]
    }
    if (route.includes('/projects?')) return [{ ...project }]
    throw new Error('Unexpected operation')
  }
  return { store, api, root, project, calls, issue: extra => issue({ store, api, projectId: PROJECT, storageReviewed: true, fixtureReviewed: true, ...extra }) }
}

test('preparation is disabled, token-free, exclusive, and network-free', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.store.readConfig(), disabledConfig())
  assert.equal(f.calls.length, 0)
  assert.match(await fs.readFile(path.join(f.root, '.gitignore'), 'utf8'), /mcp_config\.json/)
  await assert.rejects(f.store.prepare())
})
test('successful issuance returns metadata only; token exists only in disabled configuration', async t => {
  const f = await fixture(t)
  const result = await f.issue()
  assert.deepEqual(result, { connectionId: CONNECTION, disabled: true })
  const config = await f.store.readConfig()
  assert.equal(config.mcpServers[SERVER].disabled, true)
  assert.equal(config.mcpServers[SERVER].headers.Authorization, 'Bearer ' + TOKEN)
  assert.equal(JSON.stringify(await f.store.readState()).includes(TOKEN), false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(JSON.stringify(f.calls).includes(TOKEN), false)
  assert.equal(config.mcpServers[SERVER].serverUrl, BASE + '/functions/v1/trackqa-mcp')
})
for (const [name, extra, options] of [
  ['storage review missing', { storageReviewed: false }, {}],
  ['fixture review missing', { fixtureReviewed: false }, {}],
  ['wrong role', {}, { role: 'QA' }],
  ['disabled project', {}, { project: { mcp_enabled: false } }],
  ['archived project', {}, { project: { archived: true } }],
  ['wrong project', {}, { project: { id: USER } }],
  ['nonfixture project', {}, { project: { name: 'Real project' } }],
]) test('issuance refused: ' + name, async t => {
  const f = await fixture(t, options)
  await assert.rejects(f.issue(extra), /Pilot operation failed/)
  assert.equal(f.calls.some(c => c.route.endsWith('/issue_mcp_connection_token')), false)
  assert.deepEqual(await f.store.readConfig(), disabledConfig())
})
test('no automatic replay after successful issuance', async t => {
  const f = await fixture(t)
  await f.issue()
  const count = f.calls.length
  await assert.rejects(f.issue())
  assert.equal(f.calls.length, count)
})
test('cleanup revokes, verifies, disables, verifies, removes config and is repeatable', async t => {
  const f = await fixture(t)
  await f.issue()
  assert.deepEqual(await cleanup(f), { localRemoved: true, revoked: true, disabled: true, complete: true })
  await assert.rejects(fs.stat(path.join(f.root, '.agents/mcp_config.json')), { code: 'ENOENT' })
  assert.equal((await f.store.readState()).phase, 'cleaned')
  assert.equal((await cleanup(f)).complete, true)
})
test('lost issuance response is never retried; label-based recovery revokes and disables', async t => {
  const f = await fixture(t, { lostResponse: true })
  await assert.rejects(f.issue(), /Pilot operation failed/)
  assert.equal(f.calls.filter(c => c.route.endsWith('/issue_mcp_connection_token')).length, 1)
  assert.equal((await f.store.readState()).phase, 'cleaned')
  assert.equal(f.project.mcp_enabled, false)
})
test('invalid token response triggers revocation; no raw response reaches the caller', async t => {
  const f = await fixture(t, { invalidToken: true })
  await assert.rejects(f.issue(), error => error.message.includes('Pilot operation failed') && !error.message.includes(TOKEN))
  assert.equal((await f.store.readState()).revoked, true)
})
test('catchable interruption after remote issuance triggers cleanup', async t => {
  const f = await fixture(t)
  await assert.rejects(f.issue({ interrupted: () => f.calls.some(c => c.route.endsWith('/issue_mcp_connection_token')) }))
  assert.equal((await f.store.readState()).phase, 'cleaned')
})
test('configuration write failure triggers cleanup', async t => {
  const f = await fixture(t)
  const store = { ...f.store, writeConfig: async () => { throw new Error(TOKEN) } }
  await assert.rejects(issue({ ...f, store, projectId: PROJECT, storageReviewed: true, fixtureReviewed: true }))
  assert.equal((await f.store.readState()).phase, 'cleaned')
})
test('interrupted journal update preserves the previous recovery record and prevents issuance', async t => {
  const f = await fixture(t)
  const previous = await f.store.readState()
  await fs.writeFile(path.join(f.root, 'pilot-state.json.next'), '{')
  await assert.rejects(f.issue())
  assert.deepEqual(await f.store.readState(), previous)
  assert.equal(f.calls.some(c => c.route.endsWith('/issue_mcp_connection_token')), false)
})
for (const flag of ['failRevoke', 'unverifiedRevoke', 'failDisable', 'unverifiedDisable', 'invisibleConnection']) {
  test('cleanup fails closed and retains record: ' + flag, async t => {
    const options = {}
    const f = await fixture(t, options)
    await f.issue()
    options[flag] = true
    const result = await cleanup(f)
    assert.equal(result.complete, false)
    assert.equal(result.localRemoved, true)
    assert.equal((await f.store.readState()).phase, 'cleanup_required')
    assert.ok(f.calls.some(c => c.method === 'PATCH'))
  })
}
test('network/Auth failure still removes config and retains recovery metadata', async t => {
  const options = {}
  const f = await fixture(t, options)
  await f.issue()
  options.failAll = true
  const result = await cleanup(f)
  assert.equal(result.complete, false)
  assert.equal(result.localRemoved, true)
  assert.equal((await f.store.readState()).phase, 'cleanup_required')
})
test('local removal failure does not skip revocation or project disablement', async t => {
  const f = await fixture(t)
  await f.issue()
  const store = { ...f.store, removeConfig: async () => { throw new Error('file in use') } }
  const result = await cleanup({ store, api: f.api })
  assert.deepEqual(result, { localRemoved: false, revoked: true, disabled: true, complete: false })
  assert.equal((await f.store.readState()).phase, 'cleanup_required')
})
test('cleanup refuses all remote writes if the fixture identity changed', async t => {
  const f = await fixture(t)
  await f.issue()
  f.project.name = 'Different project'
  f.calls.length = 0
  const result = await cleanup(f)
  assert.equal(result.complete, false)
  assert.equal(result.localRemoved, true)
  assert.equal(f.calls.some(c => c.method !== 'GET'), false)
})
test('prepared workspace cleanup performs no remote work', async t => {
  const f = await fixture(t)
  const result = await cleanup(f)
  assert.equal(result.complete, true)
  assert.equal(result.localOnly, true)
  assert.equal(f.calls.length, 0)
})
test('transport uses only fixed project HTTPS and existing human credentials', async () => {
  const api = createHumanApi({ ownerAccessToken: AUTH, publicApiKey: KEY, fetch: async (url, init) => {
    assert.equal(url, BASE + '/auth/v1/user')
    assert.equal(init.headers.Authorization, 'Bearer ' + AUTH)
    assert.equal(init.redirect, 'error')
    return Response.json({ id: USER })
  } })
  assert.equal((await api('/auth/v1/user')).id, USER)
  await assert.rejects(api('https://attacker.invalid'))
})
for (const credentials of [
  { ownerAccessToken: jwt({ role: 'service_role' }), publicApiKey: KEY },
  { ownerAccessToken: jwt({ role: 'authenticated', client_id: 'delegated' }), publicApiKey: KEY },
  { ownerAccessToken: AUTH, publicApiKey: jwt({ role: 'service_role' }) },
]) test('wrong credential classes rejected before networking', () => {
  assert.throws(() => createHumanApi({ ...credentials, fetch: () => { throw new Error('network forbidden') } }), /Pilot operation failed/)
})
test('HTTP errors, redirects, oversize and malformed responses expose no raw details', async () => {
  for (const response of [new Response(TOKEN, { status: 403 }), new Response(TOKEN, { status: 302 }), new Response('x'.repeat(16_385)), new Response(TOKEN)]) {
    const api = createHumanApi({ ownerAccessToken: AUTH, publicApiKey: KEY, fetch: async () => response })
    await assert.rejects(api('/auth/v1/user'), e => e.message === 'Pilot operation failed. Run Cleanup; retain the recovery record if verification fails.')
  }
})
test('transport stalls are bounded and sanitized', async () => {
  const api = createHumanApi({ ownerAccessToken: AUTH, publicApiKey: KEY, timeoutMs: 15,
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true })
    }) })
  await assert.rejects(api('/auth/v1/user'), /Pilot operation failed/)
})
test('worker rejects command arguments without echoing credential material', () => {
  const result = spawnSync(process.execPath, [path.resolve('tools/mcp-pilot/pilot.mjs'), TOKEN], { encoding: 'utf8', input: '' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout.includes(TOKEN), false)
  assert.equal(result.stderr.includes(TOKEN), false)
})
test('Windows launcher refuses unapproved remote modes before prompting or changing files', { skip: process.platform !== 'win32' }, () => {
  for (const mode of ['Issue', 'Cleanup']) {
    const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-File',
      path.resolve('tools/mcp-pilot/pilot.ps1'), '-Mode', mode], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /separate explicit remote-change approval/)
    assert.equal(result.stdout.includes('Prepared:'), false)
  }
})

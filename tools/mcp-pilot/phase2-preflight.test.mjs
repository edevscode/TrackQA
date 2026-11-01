import test from 'node:test'
import assert from 'node:assert/strict'
import { FIXTURE_PROJECT_ID } from './owner-auth.mjs'
import { verifyOwnerPilotProject, verifyPilotProjectDisabled } from './phase2-preflight.mjs'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const project = { id: FIXTURE_PROJECT_ID, name: 'MCP Synthetic Pilot', key: 'MCPPILOT', owner_id: OWNER, mcp_enabled: false, archived: false }

function fixture(options = {}) {
  const calls = []
  const visible = [project, ...Array.from({ length: (options.visibleCount ?? 3) - 1 }, () => ({ id: OTHER }))]
  const api = async (route, method = 'GET') => {
    assert.equal(method, 'GET', 'preflight/verification must never mutate records')
    calls.push(route)
    if (options.transportFailure) throw new Error('synthetic-secret-must-not-escape')
    if (route === '/auth/v1/user') return { id: options.userId ?? OWNER }
    const url = new URL(route, 'https://local.test')
    assert.equal(url.searchParams.get('limit'), '2')
    assert.equal(url.searchParams.get('project_id') ?? url.searchParams.get('id'), 'eq.' + FIXTURE_PROJECT_ID)
    if (url.pathname === '/rest/v1/projects') {
      // Model an RLS-scoped view: the caller can see 1, 3 or 9 projects, but
      // querying this exact fixture must return one row, independent of totals.
      const rows = options.rows ?? visible.filter(p => p.id === FIXTURE_PROJECT_ID).map(p => ({ ...p, ...options.project }))
      return options.noProject ? [] : rows
    }
    assert.equal(url.pathname, '/rest/v1/project_members')
    assert.equal(url.searchParams.get('user_id'), 'eq.' + OWNER)
    return options.members ?? [{ user_id: OWNER, role: 'OWNER' }]
  }
  return { api, calls }
}

for (const visibleCount of [1, 3, 9]) test(`exact fixture ownership passes with ${visibleCount} Owner-visible projects`, async () => {
  const f = fixture({ visibleCount })
  assert.deepEqual(await verifyOwnerPilotProject(f.api, OWNER), { userId: OWNER, projectId: FIXTURE_PROJECT_ID, fixtureDisabled: true })
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls.filter(p => p.startsWith('/rest/v1/projects')).every(p => new URL(p, 'https://local.test').searchParams.get('id') === 'eq.' + FIXTURE_PROJECT_ID))
})

for (const [name, options, code] of [
  ['wrong authenticated identity', { userId: OTHER }, 'owner_identity_mismatch'],
  ['invisible fixture', { noProject: true }, 'fixture_unavailable'],
  ['foreign fixture ID', { project: { id: OTHER } }, 'fixture_unavailable'],
  ['wrong fixture name', { project: { name: 'Real project' } }, 'fixture_unavailable'],
  ['wrong fixture key', { project: { key: 'OTHER' } }, 'fixture_unavailable'],
  ['different project owner', { project: { owner_id: OTHER } }, 'fixture_owner_mismatch'],
  ['missing membership', { members: [] }, 'owner_membership_required'],
  ['QA membership', { members: [{ user_id: OWNER, role: 'QA' }] }, 'owner_membership_required'],
  ['developer membership', { members: [{ user_id: OWNER, role: 'DEVELOPER' }] }, 'owner_membership_required'],
  ['foreign membership identity', { members: [{ user_id: OTHER, role: 'OWNER' }] }, 'owner_membership_required'],
  ['already enabled fixture', { project: { mcp_enabled: true } }, 'fixture_state_changed'],
  ['archived fixture', { project: { archived: true } }, 'fixture_state_changed'],
  ['missing state flags', { project: { archived: undefined } }, 'fixture_state_changed'],
  ['ambiguous fixture response', { rows: [project, project] }, 'fixture_unavailable'],
]) test(`preflight fails closed for ${name}`, async () => {
  await assert.rejects(verifyOwnerPilotProject(fixture(options).api, OWNER), { safeCode: code })
})

test('cleanup verifies fixture disablement without asserting global project visibility', async () => {
  const f = fixture({ visibleCount: 3 })
  assert.deepEqual(await verifyPilotProjectDisabled(f.api), { projectId: FIXTURE_PROJECT_ID, fixtureDisabled: true })
  assert.equal(f.calls.length, 1)
})

test('cleanup fails if the fixture remains enabled or unavailable', async () => {
  await assert.rejects(verifyPilotProjectDisabled(fixture({ project: { mcp_enabled: true } }).api), { safeCode: 'fixture_disablement_failed' })
  await assert.rejects(verifyPilotProjectDisabled(fixture({ noProject: true }).api), { safeCode: 'fixture_unavailable' })
})

test('transport errors are sanitized and cannot leak underlying diagnostic text', async () => {
  for (const run of [api => verifyOwnerPilotProject(api, OWNER), verifyPilotProjectDisabled]) {
    await assert.rejects(run(fixture({ transportFailure: true }).api), error => {
      assert.equal(error.message.includes('synthetic-secret'), false)
      assert.match(error.safeCode, /verification_failed$/)
      return true
    })
  }
})

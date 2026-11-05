import assert from 'node:assert/strict'
import test from 'node:test'
import { mcpSetup, connectionStatus, connectionFields, mcpTools } from '../src/lib/mcpOnboarding.ts'
import { isActiveConnection, verifyConnectionRevoked } from '../src/lib/mcpConnections.ts'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CONNECTION = '44444444-4444-4444-8444-444444444444'
const now = Date.parse('2026-11-05T00:00:00Z')
const connection = { id: CONNECTION, project_id: PROJECT, user_id: USER, approved_by: USER, client_label: 'Synthetic client', token_expires_at: '2030-01-01T00:00:00Z', created_at: '2026-01-01', updated_at: '2026-01-01', revoked_at: null }

test('shared connector endpoint and identifiers retain exact project scope', () => {
  const setup = mcpSetup('https://project.supabase.co', PROJECT)
  assert.equal(setup.endpoint, 'https://project.supabase.co/functions/v1/trackqa-mcp')
  assert.equal(setup.serverName, 'trackqa_11111111111141118111111111111111')
  assert.equal(setup.envVar, 'TRACKQA_MCP_11111111111141118111111111111111_TOKEN')
  assert.notEqual(mcpSetup('https://project.supabase.co', OTHER).envVar, setup.envVar)
  assert.deepEqual(mcpTools.map(t => t.name), ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue', 'trackqa_submit_finding'])
})

for (const url of ['http://project.supabase.co', 'https://user:secret@project.supabase.co', 'https://project.supabase.co?token=synthetic', 'https://project.supabase.co#fragment', 'https://project.supabase.co/path', 'not-a-url']) {
  test('shared connector rejects unsafe endpoint: ' + url.split(/[?#]/)[0], () => {
    assert.throws(() => mcpSetup(url, PROJECT))
  })
}

test('shared connector refuses project-name and configuration injection', () => {
  for (const id of ['a project', PROJECT + '"\nmalicious=true', '$(unsafe)']) {
    assert.throws(() => mcpSetup('https://project.supabase.co', id))
  }
})

test('active list excludes revoked, expired, invalid and orphaned grants', () => {
  assert.equal(isActiveConnection(connection, now), true)
  for (const change of [{ revoked_at: '2026-11-01' }, { token_expires_at: '2020-01-01' }, { token_expires_at: 'invalid' }, { token_expires_at: new Date(now).toISOString() }, { user_id: null }, { approved_by: null }]) {
    assert.equal(isActiveConnection({ ...connection, ...change }, now), false)
  }
})

test('connection metadata and status never expose credentials or claim a live session', () => {
  assert.doesNotMatch(connectionFields, /token_hash|access_token/)
  assert.equal(connectionStatus(connection, true, false, true, now), 'Ready to connect')
  assert.equal(connectionStatus(connection, false, false, true, now), 'Project disabled')
  assert.equal(connectionStatus(connection, true, true, true, now), 'Project archived')
  assert.equal(connectionStatus(connection, true, false, false, now), 'Unavailable')
})

test('revocation requires the exact project, connection and a valid server timestamp', async () => {
  const row = { id: CONNECTION, project_id: PROJECT, revoked_at: '2026-01-02T00:00:00Z' }
  let calls = 0
  assert.equal(await verifyConnectionRevoked(async () => { calls++; return { data: row, error: null } }, PROJECT, CONNECTION), true)
  assert.equal(calls, 1)
  for (const data of [null, { ...row, id: OTHER }, { ...row, project_id: OTHER }, { ...row, revoked_at: null }, { ...row, revoked_at: '' }, { ...row, revoked_at: 'invalid' }]) {
    assert.equal(await verifyConnectionRevoked(async () => ({ data, error: null }), PROJECT, CONNECTION), false)
  }
})

test('ambiguous or failed verification returns uncertainty without retrying', async () => {
  let calls = 0
  assert.equal(await verifyConnectionRevoked(async () => { calls++; throw new Error('Synthetic failure') }, PROJECT, CONNECTION), false)
  assert.equal(calls, 1)
  assert.equal(await verifyConnectionRevoked(async () => ({ data: { id: CONNECTION, project_id: PROJECT, revoked_at: '2026-01-02' }, error: {} }), PROJECT, CONNECTION), false)
})

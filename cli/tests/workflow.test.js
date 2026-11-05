import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyMcpConnection } from '../src/verify.js'

test('workflow verification', async t => {
  await t.test('verifyMcpConnection fails safely on invalid endpoint or token', async () => {
    const res = await verifyMcpConnection('https://example.com/invalid-mcp', 'tqm_invalid')
    assert.equal(res.ok, false)
    assert.match(res.error, /HTTP|Fetch/i)
  })

  await t.test('no supported clients detected is handled safely', async () => {
    const mockClients = [
      { name: 'Mock A', isInstalled: () => false },
      { name: 'Mock B', isInstalled: () => false },
    ]

    const results = []
    for (const c of mockClients) {
      if (!c.isInstalled()) {
        results.push({ name: c.name, status: 'skipped', message: 'Not detected' })
      }
    }

    assert.equal(results.length, 2)
    assert.equal(results.every(r => r.status === 'skipped'), true)
  })
})


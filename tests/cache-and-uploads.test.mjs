import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryCache } from '../src/lib/memoryCache.ts'
import { uploadFiles } from '../src/lib/uploadBatch.ts'

test('switching accounts clears role-sensitive entries and rejects late responses', () => {
  const cache = new MemoryCache()
  cache.setIdentity('owner')
  const ownerRequestScope = cache.scopeVersion
  cache.set('members:project', { invitations: ['private invitation'] })
  cache.setIdentity('developer')
  assert.equal(cache.get('members:project'), null)
  cache.set('members:project', { invitations: ['late owner response'] }, 60_000, ownerRequestScope)
  assert.equal(cache.get('members:project'), null)
  cache.set('members:project', { invitations: [] })
  assert.deepEqual(cache.get('members:project'), { invitations: [] })
  cache.setIdentity(null)
  cache.set('members:project', { invitations: ['after logout'] })
  assert.equal(cache.get('members:project'), null)
  cache.setIdentity('owner')
  assert.equal(cache.get('members:project'), null)
})

test('token refresh preserves the current account cache; entries still expire', (t) => {
  let now = 100
  t.mock.method(Date, 'now', () => now)
  const cache = new MemoryCache()
  cache.setIdentity('user')
  cache.set('issues:project', ['ticket'], 1000)
  const version = cache.scopeVersion
  cache.setIdentity('user')
  assert.equal(cache.scopeVersion, version)
  assert.deepEqual(cache.get('issues:project'), ['ticket'])
  now += 1001
  assert.equal(cache.get('issues:project'), null)
})

test('project invalidation removes matching data while preserving other projects', () => {
  const cache = new MemoryCache()
  cache.setIdentity('user')
  cache.set('members:one', ['one'])
  cache.set('members:two', ['two'])
  cache.invalidate(/^members:one$/)
  assert.equal(cache.get('members:one'), null)
  assert.deepEqual(cache.get('members:two'), ['two'])
})

test('partial upload failure retains files for retry without repeating successful uploads', async () => {
  const first = new File(['a'], 'first.log')
  const second = new File(['b'], 'second.log')
  const attempts = []
  const failed = await uploadFiles([first, second], async (file) => {
    attempts.push(file.name)
    if (file === second) throw new Error('Metadata insert failed')
  })
  assert.deepEqual(failed, [second])
  assert.deepEqual(await uploadFiles(failed, async (file) => { attempts.push(file.name) }), [])
  assert.deepEqual(attempts, ['first.log', 'second.log', 'second.log'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { getIssueDraft, setIssueDraft, clearIssueDraft } from '../src/lib/issueDraftStore.ts'
import { readQueue, queueParams, changeQueue, queueReturn } from '../src/lib/issueQueue.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const params = value => new URLSearchParams(value)

test('switching projects isolates and restores report fields, deadlines and selected files', () => {
  clearIssueDraft()
  const screenshot = new File(['synthetic A'], 'a.png', { type: 'image/png' })
  setIssueDraft(A, { title: 'Project A report', assigneeId: MEMBER, resolve_by: '2030-12-01', pendingFiles: [screenshot] })
  assert.deepEqual(getIssueDraft(B), {})
  setIssueDraft(B, { title: 'Project B report', pendingFiles: [] })
  assert.equal(getIssueDraft(A).title, 'Project A report')
  assert.equal(getIssueDraft(A).resolve_by, '2030-12-01')
  assert.equal(getIssueDraft(A).assigneeId, MEMBER)
  assert.deepEqual(getIssueDraft(A).pendingFiles, [screenshot])
  assert.deepEqual(getIssueDraft(B).pendingFiles, [])
  assert.equal(getIssueDraft(B).assigneeId, undefined)
  assert.equal(getIssueDraft(A).projectId, A)
  clearIssueDraft()
})

test('attachment arrays are owned snapshots; removing files and discarding release store references', () => {
  clearIssueDraft()
  const files = [new File(['a'], 'a.txt')]
  setIssueDraft(A, { pendingFiles: files })
  files.push(new File(['b'], 'b.txt'))
  assert.equal(getIssueDraft(A).pendingFiles.length, 1)
  assert.throws(() => getIssueDraft(A).pendingFiles.push(files[1]), TypeError)
  setIssueDraft(A, { pendingFiles: [] })
  assert.deepEqual(getIssueDraft(A).pendingFiles, [])
  setIssueDraft(B, { title: 'Keep B' })
  clearIssueDraft(A)
  assert.deepEqual(getIssueDraft(A), {})
  assert.equal(getIssueDraft(B).title, 'Keep B')
  clearIssueDraft()
})

test('a completed save clears only its unchanged originating draft', () => {
  setIssueDraft(A, { title: 'Submitting A' })
  const submitted = getIssueDraft(A)
  setIssueDraft(B, { title: 'Editing B' })
  clearIssueDraft(A, submitted)
  assert.deepEqual(getIssueDraft(A), {})
  assert.equal(getIssueDraft(B).title, 'Editing B')
  setIssueDraft(A, { title: 'Submitting another A' })
  const earlier = getIssueDraft(A)
  setIssueDraft(A, { title: 'Newer edits A' })
  clearIssueDraft(A, earlier)
  assert.equal(getIssueDraft(A).title, 'Newer edits A')
  clearIssueDraft()
})

test('account cleanup clears all projects and late completion cannot erase the next account draft', () => {
  setIssueDraft(A, { title: 'Old account', pendingFiles: [new File(['old'], 'old.txt')] })
  const earlier = getIssueDraft(A)
  setIssueDraft(B, { title: 'Old B' })
  clearIssueDraft()
  assert.deepEqual(getIssueDraft(A), {})
  assert.deepEqual(getIssueDraft(B), {})
  setIssueDraft(A, { title: 'New account' })
  clearIssueDraft(A, earlier)
  assert.equal(getIssueDraft(A).title, 'New account')
  clearIssueDraft()
})

for (const path of ['/issues', '/my-tasks']) {
  test(`${path} round-trips all queue state through a detail return without correction`, () => {
    const input = params({ project: A, view: 'all', status: 'FAILED', priority: 'HIGH', q: 'login error', page: '3',
      assignee: MEMBER, deadline: 'missed', order: path === '/issues' ? 'next' : 'priority_desc', scope: 'reported' })
    const state = readQueue(path, input, A)
    const canonical = queueParams(path, state, A)
    const back = queueReturn({ queueReturn: { pathname: path, search: `?${canonical}`, projectId: A } }, A)
    const url = new URL(back.to, 'https://trackqa.test')
    assert.equal(url.pathname, path)
    assert.deepEqual(readQueue(path, url.searchParams, A), state)
    assert.equal(state.page, 3)
    assert.equal(state.q, 'login error')
    assert.equal(back.label, path === '/issues' ? 'Backlog' : 'My Tasks')
  })

  test(`${path} project changes cannot carry another project's page, filters or assignee`, () => {
    const state = readQueue(path, params({ project: A, page: '4', priority: 'CRITICAL', q: 'A report', assignee: MEMBER, scope: 'assigned' }), B)
    assert.equal(state.page, 1)
    assert.equal(state.q, '')
    assert.equal(state.priority, '')
    assert.equal(state.assignee, '')
    assert.equal(state.scope, 'mine')
  })

  test(`${path} filter changes reset page atomically; pagination preserves filters`, () => {
    let state = readQueue(path, params({ project: A, q: 'test', page: '5', priority: 'HIGH' }), A)
    state = readQueue(path, changeQueue(path, state, { status: 'FAILED' }, A), A)
    assert.equal(state.page, 1)
    assert.equal(state.q, 'test')
    assert.equal(state.priority, 'HIGH')
    state = readQueue(path, changeQueue(path, state, { page: 2 }, A), A)
    assert.equal(state.page, 2)
    assert.equal(state.status, 'FAILED')
  })

  test(`${path} completed view removes stale deadline/status/sort constraints`, () => {
    const state = readQueue(path, params({ view: 'completed', status: 'OPEN', deadline: 'upcoming', order: path === '/issues' ? 'next' : 'deadline_asc' }), A)
    assert.equal(state.view, 'completed')
    assert.equal(state.status, '')
    assert.equal(state.deadline, '')
    assert.equal(state.order, path === '/issues' ? 'newest' : 'updated_desc')
  })
}

test('invalid, duplicated and unknown queue values cannot introduce invalid query inputs', () => {
  const state = readQueue('/issues', params('page=-9&status=invalid&priority=URGENT&assignee=wrong&order=invalid&scope=other&q=x%00y&unknown=secret'), A)
  assert.equal(state.page, 1)
  assert.equal(state.status, '')
  assert.equal(state.priority, '')
  assert.equal(state.assignee, '')
  assert.equal(state.order, 'newest')
  assert.equal(state.q, 'xy')
  const canonical = queueParams('/issues', state, A)
  assert.equal(canonical.has('unknown'), false)
  for (const value of ['NaN', 'Infinity', '1.5', '0', '999999999999999']) assert.equal(readQueue('/issues', params({ page: value }), A).page, 1)
  assert.equal(readQueue('/issues', params('page=2&page=9'), A).page, 2)
  assert.equal(readQueue('/issues', params('status=DONE'), A).view, 'completed')
})

test('direct links and forged/cross-project return state safely fall back to the backlog', () => {
  for (const value of [null, {}, 'https://attacker.invalid', { queueReturn: { pathname: '//attacker.invalid', projectId: A, search: '' } },
    { queueReturn: { pathname: '/issues/secret', projectId: A, search: '' } },
    { queueReturn: { pathname: '/my-tasks', projectId: B, search: '' } }]) {
    assert.deepEqual(queueReturn(value, A), { to: '/issues', label: 'Backlog' })
  }
  assert.deepEqual(queueReturn({ queueReturn: { pathname: '/issues', projectId: A, search: '' } }, undefined), { to: '/issues', label: 'Backlog' })
})

test('browser-style Back/Forward reads each queue URL rather than retaining later component state', () => {
  const history = ['view=active&q=first&priority=HIGH&page=2', 'view=completed&q=second&priority=LOW&page=3']
  const first = readQueue('/issues', params(history[0]), A)
  const second = readQueue('/issues', params(history[1]), A)
  assert.notDeepEqual(first, second)
  assert.deepEqual(readQueue('/issues', params(history[0]), A), first)
  assert.deepEqual(readQueue('/issues', params(history[1]), A), second)
})

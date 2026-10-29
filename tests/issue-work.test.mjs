import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueLifecycle, matchesLifecycle, workGroup, workGroupOrder, issueTotals } from '../src/lib/issueWork.ts'

const issue = { assignee_id: 'dev', reporter_id: 'qa', status: 'OPEN' }
test('Active includes every unfinished state, including QA passed; only DONE is completed', () => {
  for (const status of ['OPEN', 'IN_PROGRESS', 'FOR_TESTING', 'FAILED', 'PASSED', 'DONE']) {
    assert.equal(matchesLifecycle(status, 'active'), status !== 'DONE')
    assert.equal(matchesLifecycle(status, 'completed'), status === 'DONE')
    assert.equal(matchesLifecycle(status, 'all'), true)
  }
  assert.equal(issueLifecycle(null), 'active')
  assert.equal(issueLifecycle('invalid'), 'active')
  assert.equal(issueLifecycle(null, 'DONE'), 'completed')
  assert.equal(issueLifecycle('all', 'DONE'), 'all')
})

test('development and QA handoffs change personal responsibility without completing the issue', () => {
  const expected = {
    OPEN: ['action', 'waiting'], IN_PROGRESS: ['progress', 'waiting'],
    FOR_TESTING: ['waiting', 'action'], FAILED: ['action', 'waiting'],
    PASSED: ['waiting', 'action'], DONE: ['completed', 'completed'],
  }
  for (const [status, groups] of Object.entries(expected)) {
    assert.equal(workGroup({ ...issue, status }, 'dev', 'DEVELOPER'), groups[0])
    assert.equal(workGroup({ ...issue, status }, 'qa', 'QA'), groups[1])
  }
})

test('legacy reporters retain verification responsibility; QA assignment alone never grants development responsibility', () => {
  assert.equal(workGroup({ ...issue, reporter_id: 'dev', status: 'FOR_TESTING' }, 'dev', 'DEVELOPER'), 'action')
  assert.equal(workGroup({ ...issue, assignee_id: 'qa' }, 'qa', 'QA'), 'waiting')
  assert.equal(workGroup({ ...issue, assignee_id: 'qa', status: 'IN_PROGRESS' }, 'qa', 'QA'), 'waiting')
  assert.equal(workGroup({ ...issue, assignee_id: 'qa', status: 'FOR_TESTING' }, 'qa', 'QA'), 'action')
  assert.equal(workGroup({ ...issue, reporter_id: null, status: 'FOR_TESTING' }, 'dev', 'DEVELOPER'), 'waiting')
})

test('unassigned reports need allocation; assigned owners keep development and closure responsibility', () => {
  assert.equal(workGroup({ ...issue, assignee_id: null }, 'qa', 'QA'), 'action')
  assert.equal(workGroup({ ...issue, assignee_id: 'owner', status: 'IN_PROGRESS' }, 'owner', 'OWNER'), 'progress')
  assert.equal(workGroup({ ...issue, assignee_id: 'owner', status: 'PASSED' }, 'owner', 'OWNER'), 'action')
  assert.equal(workGroup({ ...issue, status: 'FOR_TESTING' }, 'owner', 'OWNER'), 'waiting')
})

test('personal grouping gives actionable work precedence and keeps completed history last', () => {
  const rows = ['DONE', 'FOR_TESTING', 'IN_PROGRESS', 'FAILED'].map((status) => ({ ...issue, status }))
  rows.sort((a, b) => workGroupOrder(a, 'dev', 'DEVELOPER') - workGroupOrder(b, 'dev', 'DEVELOPER'))
  assert.deepEqual(rows.map((row) => row.status), ['FAILED', 'IN_PROGRESS', 'FOR_TESTING', 'DONE'])
})

test('dashboard totals include passed and failed issues exactly once', () => {
  assert.deepEqual(issueTotals(null), { active: 0, completed: 0, all: 0 })
  assert.deepEqual(issueTotals({ open_issues: 1, in_progress_issues: 2, for_testing_issues: 3, failed_issues: 4, passed_issues: 5, done_issues: 6 }),
    { active: 15, completed: 6, all: 21 })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDeadlines, deadlineState, dateInTimezone, compareResolutionDates } from '../src/lib/deadlines.ts'

const base = {
  status: 'OPEN', resolve_by: null, start_by: null, ready_for_qa_by: null, qa_decision_by: null,
  deadline_timezone: 'Asia/Manila', work_cycle: 1, work_started_at: null, ready_for_qa_at: null,
  qa_decided_at: null, completed_at: null,
}
test('optional dates validate in milestone order, including gaps and same-day targets', () => {
  assert.equal(validateDeadlines({ resolve_by: '', start_by: '', ready_for_qa_by: '', qa_decision_by: '' }), null)
  assert.equal(validateDeadlines({ resolve_by: '2026-11-03', start_by: '2026-11-03', ready_for_qa_by: '', qa_decision_by: '2026-11-03' }), null)
  assert.match(validateDeadlines({ resolve_by: '2026-11-03', start_by: '2026-11-04', ready_for_qa_by: '', qa_decision_by: '' }), /must be on or after/)
  assert.match(validateDeadlines({ resolve_by: '2026-02-30', start_by: '', ready_for_qa_by: '', qa_decision_by: '' }), /valid date/)
})
test('resolution becomes overdue at midnight in the project timezone', () => {
  const issue = { ...base, resolve_by: '2026-10-30' }
  assert.equal(deadlineState(issue, new Date('2026-10-30T15:59:59Z')).overdue, false)
  assert.equal(deadlineState(issue, new Date('2026-10-30T16:00:00Z')).overdue, true)
  assert.equal(dateInTimezone('2026-10-30T16:00:00Z', 'Pacific/Honolulu'), '2026-10-30')
})
test('deadline day boundaries respect daylight-saving timezone rules', () => {
  const issue = { ...base, deadline_timezone: 'America/New_York', resolve_by: '2026-11-01' }
  assert.equal(deadlineState(issue, new Date('2026-11-02T04:59:59Z')).overdue, false)
  assert.equal(deadlineState(issue, new Date('2026-11-02T05:00:00Z')).overdue, true)
})
test('a failed QA decision can meet its target while resolution remains overdue', () => {
  const state = deadlineState({ ...base, status: 'FAILED', qa_decision_by: '2026-10-30', resolve_by: '2026-10-30', qa_decided_at: '2026-10-30T10:00:00Z' }, new Date('2026-10-31T08:00:00Z'))
  assert.equal(state.overdue, true)
  assert.equal(state.targets.find((target) => target.key === 'qa_decision_by').late, false)
})
test('late completion stays historical and never counts as an open overdue issue', () => {
  const state = deadlineState({ ...base, status: 'DONE', resolve_by: '2026-10-30', completed_at: '2026-10-31T08:00:00Z' })
  assert.equal(state.overdue, false)
  assert.equal(state.completedLate, true)
})
test('unscheduled targets produce no missed flags and sort after scheduled dates', () => {
  const state = deadlineState(base)
  assert.equal(state.overdue, false)
  assert.equal(state.missedStage, false)
  assert.ok(compareResolutionDates({ resolve_by: '2026-11-01' }, { resolve_by: null }) < 0)
})

test('legacy milestones without measured timestamps stay unknown instead of becoming false misses', () => {
  const state = deadlineState({ ...base, status: 'FOR_TESTING', start_by: '2020-01-01', ready_for_qa_by: '2020-01-01' })
  assert.equal(state.missedStage, false)
  assert.equal(state.targets.find((target) => target.key === 'start_by').unknown, true)
  assert.ok(compareResolutionDates({ resolve_by: '2020-01-01', status: 'DONE' }, { resolve_by: '2026-11-01', status: 'OPEN' }) > 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deadlineInput, deadlinePayload, deadlineMode, emptyDeadlines, validateDeadlines, deadlineState, dateInTimezone, compareResolutionDates, localDeadlineInstant, removedDeadlineTargets, formatDeadline, displayedDeadline, formatSavedDeadline } from '../src/lib/deadlines.ts'

const base = {
  status: 'OPEN', deadline_mode: 'none', resolve_by: null, start_by: null, ready_for_qa_by: null, qa_decision_by: null,
  start_time: null, ready_for_qa_time: null, qa_decision_time: null, resolve_time: null,
  start_cutoff_at: null, ready_for_qa_cutoff_at: null, qa_decision_cutoff_at: null, resolve_cutoff_at: null,
  deadline_timezone: 'Asia/Manila', work_cycle: 1, work_started_at: null, ready_for_qa_at: null,
  qa_decided_at: null, completed_at: null,
}

test('deadline modes are independent and only their active targets are persisted', () => {
  const stages = deadlineInput({ deadline_mode: 'stages', start_by: '2026-11-03', resolve_by: '2026-11-04', start_time: '10:00' })
  const single = { ...stages, deadline_mode: 'single' }
  assert.equal(single.start_by, '2026-11-03') // Draft is retained for toggling back.
  assert.equal(deadlinePayload(single).start_by, null)
  assert.equal(deadlinePayload(single).start_time, null)
  assert.equal(deadlinePayload(single).resolve_by, '2026-11-04')
  const none = deadlinePayload({ ...stages, deadline_mode: 'none' })
  assert.equal(none.resolve_by, null)
  assert.equal(none.start_time, null)
  assert.equal(validateDeadlines({ ...stages, deadline_mode: 'none' }), null)
})
test('single needs a resolution date; stage planning can omit the overall deadline', () => {
  assert.match(validateDeadlines({ ...emptyDeadlines, deadline_mode: 'single' }), /Resolve by/)
  assert.match(validateDeadlines({ ...emptyDeadlines, deadline_mode: 'stages' }), /at least one/)
  assert.equal(validateDeadlines(deadlineInput({ deadline_mode: 'stages', ready_for_qa_by: '2026-11-03', ready_for_qa_time: '16:00' })), null)
})
test('date and time ordering includes gaps, same-day targets, and end of day', () => {
  assert.equal(validateDeadlines(deadlineInput({ deadline_mode: 'stages', start_by: '2026-11-03', start_time: '10:00', qa_decision_by: '2026-11-03', qa_decision_time: '15:00' })), null)
  assert.match(validateDeadlines(deadlineInput({ deadline_mode: 'stages', start_by: '2026-11-03', start_time: '16:00', qa_decision_by: '2026-11-03', qa_decision_time: '15:00' })), /must be on or after/)
  assert.match(validateDeadlines(deadlineInput({ deadline_mode: 'stages', start_by: '2026-11-03', ready_for_qa_by: '2026-11-03', ready_for_qa_time: '17:00' })), /must be on or after/)
  assert.match(validateDeadlines(deadlineInput({ deadline_mode: 'single', resolve_by: '2026-02-30' })), /valid date/)
})
test('clearing an explicit time does not silently convert it to end of day', () => {
  const input = deadlineInput({ deadline_mode: 'single', resolve_by: '2026-11-03', resolve_time: '17:00' })
  input.resolve_time = ''
  assert.equal(input.end_of_day.resolve_by, false)
  assert.match(validateDeadlines(input), /Choose a time/)
  input.end_of_day.resolve_by = true
  assert.equal(validateDeadlines(input), null)
  assert.equal(deadlinePayload(input).resolve_time, null)
})
test('explicit cutoffs expire at their exact time in the project timezone', () => {
  const issue = { ...base, deadline_mode: 'single', resolve_by: '2026-10-30', resolve_time: '17:00' }
  assert.equal(deadlineState(issue, new Date('2026-10-30T08:59:59Z')).overdue, false)
  assert.equal(deadlineState(issue, new Date('2026-10-30T09:00:00Z')).overdue, false)
  assert.equal(deadlineState(issue, new Date('2026-10-30T09:00:00.001Z')).overdue, true)
})
test('legacy dates retain their end-of-day cutoff across timezones', () => {
  const issue = { ...base, deadline_mode: 'single', resolve_by: '2026-10-30' }
  assert.equal(deadlineState(issue, new Date('2026-10-30T15:59:59.999Z')).overdue, false)
  assert.equal(deadlineState(issue, new Date('2026-10-30T16:00:00Z')).overdue, true)
  assert.equal(dateInTimezone('2026-10-30T16:00:00Z', 'Pacific/Honolulu'), '2026-10-30')
  assert.match(formatDeadline('2026-10-30'), /End of day/)
  assert.equal(deadlineMode({ start_by: '2026-10-30' }), 'stages')
  assert.equal(deadlineMode({ resolve_by: '2026-10-30' }), 'single')
})
test('clock-change gaps and repeated local times are rejected explicitly', () => {
  assert.throws(() => localDeadlineInstant('2026-03-08', '02:30', 'America/New_York'), /does not exist/)
  assert.throws(() => localDeadlineInstant('2026-11-01', '01:30', 'America/New_York'), /occurs twice/)
  assert.equal(new Date(localDeadlineInstant('2026-11-01', '17:00', 'America/New_York')).toISOString(), '2026-11-01T22:00:00.000Z')
})
test('end of day includes a repeated final hour and handles a skipped midnight', () => {
  assert.equal(new Date(localDeadlineInstant('2026-10-29', null, 'Africa/Cairo')).toISOString(), '2026-10-29T21:59:59.999Z')
  assert.equal(new Date(localDeadlineInstant('2026-09-05', null, 'America/Santiago')).toISOString(), '2026-09-06T03:59:59.999Z')
  assert.throws(() => localDeadlineInstant('2011-12-30', null, 'Pacific/Apia'), /calendar date does not exist/)
})
test('only active mode targets affect overdue and stage-miss indicators', () => {
  const issue = { ...base, start_by: '2020-01-01', resolve_by: '2020-01-01' }
  assert.equal(deadlineState(issue).overdue, false)
  assert.equal(deadlineState(issue).missedStage, false)
  assert.equal(deadlineState({ ...issue, deadline_mode: 'single' }).missedStage, false)
  const partial = { ...issue, deadline_mode: 'stages', resolve_by: null }
  assert.equal(deadlineState(partial).overdue, false)
  assert.equal(deadlineState(partial).missedStage, true)
})
test('mode changes identify saved targets that require removal acknowledgement', () => {
  const issue = { ...base, deadline_mode: 'stages', start_by: '2026-11-01', qa_decision_by: '2026-11-02', resolve_by: '2026-11-03' }
  assert.deepEqual(removedDeadlineTargets(issue, { ...deadlineInput(issue), deadline_mode: 'single' }), ['start_by', 'qa_decision_by'])
  assert.deepEqual(removedDeadlineTargets(issue, { ...deadlineInput(issue), deadline_mode: 'none' }), ['start_by', 'qa_decision_by', 'resolve_by'])
})
test('QA can meet its decision target while the resolution is late', () => {
  const state = deadlineState({ ...base, deadline_mode: 'stages', status: 'FAILED', qa_decision_by: '2026-10-30', qa_decision_time: '17:00', resolve_by: '2026-10-30', resolve_time: '18:00', qa_decided_at: '2026-10-30T08:30:00Z' }, new Date('2026-10-31T08:00:00Z'))
  assert.equal(state.overdue, true)
  assert.equal(state.targets.find((target) => target.key === 'qa_decision_by').late, false)
})
test('late completion stays historical and exact cutoff sorting puts closed and unscheduled issues last', () => {
  const state = deadlineState({ ...base, deadline_mode: 'single', status: 'DONE', resolve_by: '2026-10-30', resolve_time: '17:00', completed_at: '2026-10-30T09:00:01Z' })
  assert.equal(state.overdue, false)
  assert.equal(state.completedLate, true)
  const first = { ...base, deadline_mode: 'single', resolve_by: '2026-11-01', resolve_time: '10:00' }
  const later = { ...first, resolve_time: '15:00' }
  assert.ok(compareResolutionDates(first, later) < 0)
  assert.ok(compareResolutionDates(first, base) < 0)
  assert.ok(compareResolutionDates({ ...first, status: 'DONE' }, later) > 0)
})
test('legacy missing milestone measurements stay unknown', () => {
  const state = deadlineState({ ...base, deadline_mode: 'stages', status: 'FOR_TESTING', start_by: '2020-01-01' })
  assert.equal(state.missedStage, false)
  assert.equal(state.targets[0].unknown, true)
})

test('new scheduling uses the detected entry timezone, independent of project defaults', () => {
  const input = deadlineInput({ deadline_mode: 'single', resolve_by: '2026-11-03', resolve_time: '10:00' }, 'Pacific/Auckland')
  assert.equal(input.entry_timezone, 'Pacific/Auckland')
  assert.equal(input.resolve_time, '10:00')
  assert.equal(deadlinePayload(input).resolve_timezone, 'Pacific/Auckland')
  assert.equal(validateDeadlines(input), null)
})
test('one saved UTC cutoff displays in each viewer timezone without moving the deadline', () => {
  const source = { ...base, deadline_mode: 'single', resolve_by: '2026-10-30', resolve_timezone: 'Asia/Manila', resolve_cutoff_at: '2026-10-30T15:59:59.999999Z' }
  assert.deepEqual(displayedDeadline(source, 'resolve_by', 'Asia/Manila'), { date: '2026-10-30', time: null, timezone: 'Asia/Manila' })
  assert.deepEqual(displayedDeadline(source, 'resolve_by', 'America/New_York'), { date: '2026-10-30', time: '11:59:59.999', timezone: 'America/New_York' })
  assert.deepEqual(displayedDeadline(source, 'resolve_by', 'Pacific/Auckland'), { date: '2026-10-31', time: '04:59:59.999', timezone: 'Pacific/Auckland' })
  assert.match(formatSavedDeadline(source, 'resolve_by', 'Pacific/Auckland'), /Oct 31.*Pacific\/Auckland/)
  const input = deadlineInput(source, 'America/New_York')
  assert.equal(validateDeadlines(input, input.entry_timezone, source), null)
  const payload = deadlinePayload(input, source)
  assert.equal(payload.resolve_by, '2026-10-30')
  assert.equal(payload.resolve_time, null)
  assert.equal(payload.resolve_timezone, 'Asia/Manila')
})
test('changing one target uses the editor timezone and preserves untouched targets in their original zones', () => {
  const source = { ...base, deadline_mode: 'stages', start_by: '2026-10-29', start_time: '12:00', start_timezone: 'Asia/Tokyo', start_cutoff_at: '2026-10-29T03:00:00Z', resolve_by: '2026-10-30', resolve_timezone: 'Asia/Manila', resolve_cutoff_at: '2026-10-30T15:59:59.999999Z' }
  const input = deadlineInput(source, 'America/New_York')
  input.ready_for_qa_by = '2026-10-30'
  input.ready_for_qa_time = '10:00'
  input.end_of_day.ready_for_qa_by = false
  assert.equal(validateDeadlines(input, input.entry_timezone, source), null)
  const payload = deadlinePayload(input, source)
  assert.equal(payload.start_by, '2026-10-29')
  assert.equal(payload.start_timezone, 'Asia/Tokyo')
  assert.equal(payload.ready_for_qa_timezone, 'America/New_York')
  assert.equal(payload.resolve_time, null)
  assert.equal(payload.resolve_timezone, 'Asia/Manila')
})
test('an unchanged saved instant remains valid when the viewer sees a repeated local clock time', () => {
  const source = { ...base, deadline_mode: 'single', deadline_timezone: 'UTC', resolve_timezone: 'UTC', resolve_by: '2026-11-01', resolve_time: '06:30', resolve_cutoff_at: '2026-11-01T06:30:00Z' }
  const input = deadlineInput(source, 'America/New_York')
  assert.equal(input.resolve_time, '01:30')
  assert.equal(validateDeadlines(input, input.entry_timezone, source), null)
  assert.equal(deadlinePayload(input, source).resolve_time, '06:30')
  input.resolve_time = '01:45'
  assert.match(validateDeadlines(input, input.entry_timezone, source), /occurs twice/)
})
test('an in-progress draft follows a changed device timezone without reinterpreting its cutoff', () => {
  const first = deadlineInput({ deadline_mode: 'single', resolve_by: '2026-11-03', resolve_time: '10:00' }, 'Pacific/Auckland')
  const original = localDeadlineInstant(first.resolve_by, first.resolve_time, first.entry_timezone)
  const moved = deadlineInput(first, 'America/New_York')
  assert.equal(moved.entry_timezone, 'America/New_York')
  assert.equal(localDeadlineInstant(moved.resolve_by, moved.resolve_time, moved.entry_timezone), original)
})

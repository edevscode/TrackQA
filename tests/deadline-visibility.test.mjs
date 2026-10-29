import './tsx-loader.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { deadlineInput } from '../src/lib/deadlines.ts'

const [{ default: DeadlineFields }, { default: DeadlineSummary }, { default: DeadlineHistoryPanel }, { default: DeadlineOverview }] = await Promise.all([
  import('../src/components/DeadlineFields.tsx'),
  import('../src/components/DeadlineSummary.tsx'),
  import('../src/components/DeadlineHistoryPanel.tsx'),
  import('../src/components/DeadlineOverview.tsx'),
])

const issue = {
  status: 'OPEN', deadline_mode: 'single', resolve_by: '2030-11-03', resolve_time: '17:00',
  resolve_timezone: 'UTC', resolve_cutoff_at: '2030-11-03T17:00:00Z',
  start_by: null, ready_for_qa_by: null, qa_decision_by: null,
  start_time: null, ready_for_qa_time: null, qa_decision_time: null,
  start_timezone: null, ready_for_qa_timezone: null, qa_decision_timezone: null,
  start_cutoff_at: null, ready_for_qa_cutoff_at: null, qa_decision_cutoff_at: null,
  deadline_timezone: 'UTC', work_cycle: 3, work_started_at: null,
  ready_for_qa_at: null, qa_decided_at: null, completed_at: null,
}
function entry(event, status, mode = 'single', before = null) {
  return {
    id: `${event}-${status}-${mode}`, issue_id: 'issue', actor_id: null, event, work_cycle: 3,
    created_at: '2026-10-29T08:00:00Z', before_values: before,
    after_values: { ...issue, timezone: 'UTC', status, deadline_mode: mode },
  }
}
const render = (component, props) => renderToStaticMarkup(createElement(component, props))

test('single deadline forms and summaries contain resolution controls without stage or cycle details', () => {
  const fields = render(DeadlineFields, { value: deadlineInput(issue, 'UTC'), onChange() {}, timezone: 'UTC', prefix: 'test' })
  assert.match(fields, /id="test-resolve_by"/)
  assert.doesNotMatch(fields, /id="test-(start_by|ready_for_qa_by|qa_decision_by)"/)
  const summary = render(DeadlineSummary, { issue })
  assert.match(summary, /Resolve by/)
  assert.doesNotMatch(summary, /Start work by|Ready for QA by|QA decision by|cycle|Stage target missed/)
})
test('single history hides development/QA cycle events and displays deadline edits and resolution', () => {
  const entries = [entry('CREATED', 'OPEN'), entry('TARGETS_CHANGED', 'OPEN'),
    entry('MILESTONE_REACHED', 'IN_PROGRESS'), entry('MILESTONE_REACHED', 'FOR_TESTING'),
    entry('MILESTONE_REACHED', 'FAILED'), entry('REWORK_STARTED', 'IN_PROGRESS'),
    entry('MILESTONE_REACHED', 'PASSED'), entry('MILESTONE_REACHED', 'DONE')]
  const html = render(DeadlineHistoryPanel, { entries, members: [] })
  assert.match(html, /Deadline history \(3\)/)
  assert.match(html, /Deadline changed|Issue resolved/)
  assert.doesNotMatch(html, /cycle|Start work by|Ready for QA by|QA decision by|Development resumed|Milestone recorded|FOR_TESTING/)
})
test('stage mode retains its target controls and work-cycle history', () => {
  const stageIssue = { ...issue, deadline_mode: 'stages', start_by: '2030-11-01', start_timezone: 'UTC' }
  const fields = render(DeadlineFields, { value: deadlineInput(stageIssue, 'UTC'), onChange() {}, timezone: 'UTC', prefix: 'stage' })
  assert.match(fields, /id="stage-start_by"/)
  assert.match(fields, /id="stage-ready_for_qa_by"/)
  assert.match(fields, /id="stage-qa_decision_by"/)
  assert.match(render(DeadlineSummary, { issue: stageIssue }), /work cycle 3/)
  const html = render(DeadlineHistoryPanel, { entries: [entry('REWORK_STARTED', 'IN_PROGRESS', 'stages')], members: [] })
  assert.match(html, /Development resumed.*cycle 3/)
})
test('no-deadline mode has no scheduling controls, badges, or unrelated history', () => {
  const none = { ...issue, deadline_mode: 'none', resolve_by: null }
  const fields = render(DeadlineFields, { value: deadlineInput(none, 'UTC'), onChange() {}, timezone: 'UTC', prefix: 'none' })
  assert.doesNotMatch(fields, /type="date"|type="time"/)
  const summary = render(DeadlineSummary, { issue: none })
  assert.match(summary, /No deadline/)
  assert.doesNotMatch(summary, /<dl|overdue|cycle|timezone|Not scheduled/)
  assert.equal(render(DeadlineHistoryPanel, { entries: [entry('CREATED', 'OPEN', 'none'), entry('MILESTONE_REACHED', 'IN_PROGRESS', 'none')], members: [] }), '')
})
test('switching from stages to single keeps the removed targets in the explicit type-change audit', () => {
  const before = { ...issue, timezone: 'UTC', deadline_mode: 'stages', start_by: '2030-11-01', start_timezone: 'UTC' }
  const changed = entry('TARGETS_CHANGED', 'OPEN', 'single', before)
  const html = render(DeadlineHistoryPanel, { entries: [changed], members: [] })
  assert.match(html, /Deadline type changed/)
  assert.match(html, /Stage deadlines.*Single deadline/)
  assert.match(html, /Start work by/)
  assert.doesNotMatch(html, /cycle|Previous cycle QA/)
})

test('dashboard shows three deadline counters and links Due soon to its backlog filter', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(DeadlineOverview, { stats: { overdue_issues: 2, missed_target_issues: 3, due_soon_issues: 7 } })))
  const cards = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  assert.equal(cards.length, 3)
  const upcoming = cards.find((card) => card[1] === '/issues?deadline=upcoming')
  assert.ok(upcoming)
  assert.match(upcoming[2], /Due soon/)
  assert.match(upcoming[2], /<strong[^>]*>7<\/strong>/)
  assert.match(upcoming[2], /next 7 days/)
  const empty = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DeadlineOverview, { stats: null })))
  assert.equal([...empty.matchAll(/<strong[^>]*>0<\/strong>/g)].length, 3)
})

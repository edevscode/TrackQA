import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { loadPendingInvitations, invitationLoadMessage } from '../src/lib/projectInvitations.ts'
import { isFindingRangeError, recoverFindingPage } from '../src/lib/findingPagination.ts'
import { issueStatusLabels, issueStatusLabel, matchesLifecycle } from '../src/lib/issueWork.ts'

test('a successful empty invitation request is distinct from failure', async () => {
  let received
  assert.deepEqual(await loadPendingInvitations(' Owner@Example.invalid ', async email => {
    received = email
    return { data: [], error: null }
  }), [])
  assert.equal(received, 'owner@example.invalid')
})

test('successful invitations are returned without changing their roles or identifiers', async () => {
  const rows = [{ id: 'synthetic-invitation', role: 'QA', status: 'PENDING' }]
  assert.equal(await loadPendingInvitations('owner@example.invalid', async () => ({ data: rows, error: null })), rows)
})

for (const response of [{ data: null, error: { message: 'private server detail' } },
  { data: [], error: { message: 'request failed' } }, { data: null, error: null }]) {
  test('an unsuccessful invitation response cannot be mistaken for no invitations', async () => {
    await assert.rejects(loadPendingInvitations('owner@example.invalid', async () => response),
      error => error.message === invitationLoadMessage)
  })
}

test('transport failures are generic and retry is explicit, not automatic', async () => {
  let attempts = 0
  const request = async () => {
    if (++attempts === 1) throw new Error('private transport detail')
    return { data: [], error: null }
  }
  await assert.rejects(loadPendingInvitations('owner@example.invalid', request), { message: invitationLoadMessage })
  assert.equal(attempts, 1)
  assert.deepEqual(await loadPendingInvitations('owner@example.invalid', request), [])
  assert.equal(attempts, 2)
})

test('missing invitation identity does not execute a query or report successful emptiness', async () => {
  let calls = 0
  await assert.rejects(loadPendingInvitations('', async () => { calls++; return { data: [], error: null } }))
  assert.equal(calls, 0)
})

test('reviewing the 26th and final pending item recovers to the first page', () => {
  assert.equal(recoverFindingPage(1, 0, 25, 25), 0)
  assert.equal(recoverFindingPage(0, 25, 25, 25), 0)
})

test('only a stale-page PostgREST range failure permits a filtered recount', () => {
  assert.equal(isFindingRangeError(1, 416, 'PGRST103'), true)
  for (const [page, status, code] of [[0, 416, 'PGRST103'], [1, 401, 'PGRST103'], [1, 403, '42501'], [1, 500, 'PGRST103'], [1, 416, 'other']]) {
    assert.equal(isFindingRangeError(page, status, code), false)
  }
})

test('many removed pages recover directly to the nearest valid page', () => {
  assert.equal(recoverFindingPage(9, 0, 51, 25), 2)
  assert.equal(recoverFindingPage(9, 0, 50, 25), 1)
  assert.equal(recoverFindingPage(9, 0, 0, 25), 0)
})

test('a nonempty page stays selected, including the Reviewed view', () => {
  assert.equal(recoverFindingPage(2, 1, 51, 25), 2)
  assert.equal(recoverFindingPage(1, 25, 50, 25), 1)
})

test('recovery terminates at page zero even when every finding disappears', () => {
  const target = recoverFindingPage(5, 0, 0, 25)
  assert.equal(target, 0)
  assert.equal(recoverFindingPage(target, 0, 0, 25), target)
})

test('missing or inconsistent counts fail rather than endlessly refetch an empty page', () => {
  for (const count of [null, NaN, Infinity, -1, 1.5, 26]) {
    assert.throws(() => recoverFindingPage(1, 0, count, 25))
  }
  assert.throws(() => recoverFindingPage(1, 0, 0, 0))
})

const labels = { OPEN: 'Open', IN_PROGRESS: 'In Progress', FOR_TESTING: 'For Testing', PASSED: 'QA Passed', FAILED: 'QA Failed', DONE: 'Closed' }
test('all six database values retain one consistent display label and lifecycle meaning', () => {
  assert.deepEqual(issueStatusLabels, labels)
  for (const [status, label] of Object.entries(labels)) {
    assert.equal(issueStatusLabel(status), label)
    assert.equal(matchesLifecycle(status, 'completed'), status === 'DONE')
  }
  assert.equal(issueStatusLabel('historic unknown value'), 'historic unknown value')
  assert.equal(issueStatusLabel(null), '—')
})

// Evaluate the actual page configuration declarations without mounting Auth,
// loading Supabase credentials or replacing the shared labels with test mocks.
function pageConfig(page, name) {
  const text = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
  const source = ts.createSourceFile(page + '.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
    if (statement.declarationList.declarations.some(d => d.name.getText(source) === name)) declaration = statement.getText(source)
  }
  assert.ok(declaration, 'page configuration exists')
  const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText
  return runInNewContext(js + `\nJSON.stringify(${name})`, { issueStatusLabels })
}
for (const page of ['Issues', 'MyTasks', 'IssueDetail']) {
  test(`${page} badges use the same actual status labels`, () => {
    const config = JSON.parse(pageConfig(page, 'statusConfig'))
    assert.deepEqual(Object.fromEntries(Object.entries(config).map(([value, item]) => [value, item.label])), labels)
  })
}
test('My Tasks filter choices match the badges', () => {
  const options = JSON.parse(pageConfig('MyTasks', 'statusOptions')).filter(item => item.value)
  assert.deepEqual(Object.fromEntries(options.map(item => [item.value, item.label])), labels)
})
test('issue workflow steps keep their original status sequence with consistent labels', () => {
  const steps = JSON.parse(pageConfig('IssueDetail', 'workflowSteps'))
  assert.deepEqual(steps.map(step => step.status), ['OPEN', 'IN_PROGRESS', 'FOR_TESTING', 'PASSED', 'DONE'])
  for (const step of steps) assert.equal(step.label, labels[step.status])
})

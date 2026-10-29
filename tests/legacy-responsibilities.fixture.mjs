import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function seedLegacyResponsibilities(db) {
  const owner = randomUUID(), reporter = randomUUID(), qa = randomUUID(), project = randomUUID()
  const issue = randomUUID(), legacyAssignment = randomUUID()
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',
    [owner, `${owner}@example.invalid`, reporter, `${reporter}@example.invalid`, qa, `${qa}@example.invalid`])
  await db.query('insert into public.projects(id,name,key,owner_id) values($1,$2,$3,$4)',
    [project, 'Legacy responsibilities', `R${project.replaceAll('-', '').slice(0,8).toUpperCase()}`, owner])
  await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'OWNER'),($1,$3,'DEVELOPER'),($1,$4,'QA')", [project,owner,reporter,qa])
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:reporter,role:'authenticated'})])
  await db.exec('set role authenticated')
  try {
    await db.query('insert into public.issues(id,project_id,title,assignee_id) values($1,$2,$3,$4),($5,$2,$6,$7)',
      [issue,project,'Legacy developer report',reporter,legacyAssignment,'Legacy QA assignee',qa])
    await db.query("update public.issues set status='IN_PROGRESS' where id=$1", [issue])
    await db.query("update public.issues set status='FOR_TESTING' where id=$1", [issue])
  } finally { await db.exec("reset role; select set_config('request.jwt.claims','{}',false)") }
  const before = (await db.query('select * from public.issues where project_id=$1 order by id',[project])).rows
  const history = (await db.query('select h.* from public.issue_deadline_history h join public.issues i on i.id=h.issue_id where i.project_id=$1 order by h.id',[project])).rows
  return {owner,reporter,qa,project,issue,legacyAssignment,before,history}
}

export async function assertLegacyResponsibilities(db, f) {
  assert.deepEqual((await db.query('select * from public.issues where project_id=$1 order by id',[f.project])).rows,f.before)
  assert.deepEqual((await db.query('select h.* from public.issue_deadline_history h join public.issues i on i.id=h.issue_id where i.project_id=$1 order by h.id',[f.project])).rows,f.history)
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:f.reporter,role:'authenticated'})])
    await db.exec('set local role authenticated')
    await db.query('update public.issues set title=$1,assignee_id=$2 where id=$3', ['Edited legacy issue',f.qa,f.legacyAssignment])
    // Existing developer reporters retain ownership and can finish QA atomically.
    await db.query("select public.qa_verify_issue($1,'PASSED','Legacy verification',null)", [f.issue])
    await db.query("update public.issues set status='DONE' where id=$1", [f.issue])
    assert.equal((await db.query('select count(*)::int as count from public.qa_verifications where issue_id=$1',[f.issue])).rows[0].count,1)
    // The old QA assignment does not confer developer permissions.
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:f.qa,role:'authenticated'})])
    await db.exec('savepoint denied')
    await assert.rejects(db.query("update public.issues set status='IN_PROGRESS' where id=$1",[f.legacyAssignment]), {code:'P0001'})
    await db.exec('rollback to savepoint denied')
    // Its original reporter can repair the assignment without identity changes.
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:f.reporter,role:'authenticated'})])
    await db.query('update public.issues set assignee_id=$1 where id=$2',[f.reporter,f.legacyAssignment])
    await db.query("update public.issues set status='IN_PROGRESS' where id=$1",[f.legacyAssignment])
    await db.exec('savepoint denied')
    await assert.rejects(db.query('insert into public.issues(project_id,title) values($1,$2)',[f.project,'New developer report']), {code:'42501'})
    await db.exec('rollback to savepoint denied')
  } finally { await db.exec('rollback; reset role') }
}

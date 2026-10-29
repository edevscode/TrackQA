import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const columns = 'id,title,status,resolve_by,start_by,ready_for_qa_by,qa_decision_by,deadline_timezone,work_cycle,work_started_at,ready_for_qa_at,qa_decided_at,completed_at,created_at,updated_at'

export async function seedLegacyDeadlines(db) {
  const actor = randomUUID(), project = randomUUID()
  const ids = Array.from({ length: 5 }, randomUUID)
  await db.query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@example.invalid`])
  await db.query('insert into public.projects(id,name,key,owner_id) values($1,$2,$3,$4)', [project, 'Legacy deadline migration', `M${project.replaceAll('-', '').slice(0, 8).toUpperCase()}`, actor])
  await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'OWNER')", [project, actor])
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor, role: 'authenticated' })])
  await db.exec('set role authenticated;')
  try {
    for (let index = 0; index < ids.length; index++) {
      await db.query('insert into public.issues(id,project_id,title,assignee_id,resolve_by,start_by) values($1,$2,$3,$4,$5,$6)', [
        ids[index], project, `Legacy ${index}`, actor,
        index === 0 ? null : index < 3 ? '2030-02-03' : '2020-02-03',
        index === 2 ? '2030-02-01' : index === 4 ? '2020-02-01' : null,
      ])
      if (index >= 3) {
        await db.query("update public.issues set status='IN_PROGRESS' where id=$1", [ids[index]])
        await db.query("update public.issues set status='FOR_TESTING' where id=$1", [ids[index]])
        await db.query("select public.qa_verify_issue($1,'PASSED','Legacy pass',null)", [ids[index]])
        await db.query("update public.issues set status='DONE' where id=$1", [ids[index]])
      }
    }
  } finally {
    await db.exec('reset role;')
    await db.query("select set_config('request.jwt.claims','{}',false)")
  }
  const before = (await db.query(`select ${columns} from public.issues where project_id=$1 order by id`, [project])).rows
  const history = (await db.query('select h.* from public.issue_deadline_history h join public.issues i on i.id=h.issue_id where i.project_id=$1 order by h.id', [project])).rows
  return { ids, project, before, history }
}

export async function assertLegacyDeadlineMigration(db, fixture) {
  const { ids, project, before, history } = fixture
  assert.deepEqual((await db.query(`select ${columns} from public.issues where project_id=$1 order by id`, [project])).rows, before)
  assert.deepEqual((await db.query('select h.* from public.issue_deadline_history h join public.issues i on i.id=h.issue_id where i.project_id=$1 order by h.id', [project])).rows, history)
  for (const [index, mode] of ['none', 'single', 'stages', 'single', 'stages'].entries()) {
    const row = (await db.query("select deadline_mode,resolve_time,to_char(resolve_cutoff_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') as cutoff from public.issues where id=$1", [ids[index]])).rows[0]
    assert.equal(row.deadline_mode, mode)
    assert.equal(row.resolve_time, null)
    assert.equal(row.cutoff, index === 0 ? null : `${index < 3 ? '2030' : '2020'}-02-03 15:59:59.999999`)
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { connect, status, disconnect } from '../src/workflow.ts'
import { Store } from '../src/state.ts'
import { fingerprint, matchesEntry } from '../src/clients/codex.ts'
import { matchesGeminiEntry } from '../src/clients/gemini.ts'
import { geminiInstructions, geminiVerification } from '../src/clients/gemini-verify.ts'
import { setupFor, ConnectorError } from '../src/core.ts'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const CONNECTION = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'tqm_' + 'a'.repeat(64)
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(),'trackqa-connect-flow-'))
  t.after(async () => { assert.ok(root.startsWith(path.join(os.tmpdir(),'trackqa-connect-flow-'))); await rm(root,{recursive:true,force:true}) })
  const store = new Store(root), calls = [], output = [], approvals = [], entries = new Map([['unrelated',{ name:'unrelated', transport:{ type:'stdio', command:'keep-me' } }]])
  const unrelated = JSON.stringify(entries.get('unrelated'))
  const project = { id:PROJECT,name:'Owner project',key:'REAL',mcp_enabled:options.enabled ?? true,archived:false }
  let connection = null, issuanceResponse, issued = 0, revoked = 0, launched = 0, verified = 0
  const adapter = {
    ...(options.client === 'gemini' ? { client:'gemini',label:'Gemini',configurationHome:path.join(root,'gemini-home'),matches:matchesGeminiEntry,manualInstructions:geminiInstructions } : {}),
    executable:{path:path.join(root,'codex.exe'),sha256:'a'.repeat(64),version:'mock',appServer:true},codexHome:path.join(root,'codex-home'),
    async entry(setup) { return entries.get(setup.serverName) ?? null },
    async install(setup) {
      assert.ok(!entries.has(setup.serverName))
      const entry = options.client === 'gemini' ? {httpUrl:setup.endpoint,headers:{Authorization:'Bearer ${'+setup.envVar+'}'}}
        : { name:setup.serverName,enabled:true,transport:{ type:'streamable_http',url:setup.endpoint,bearer_token_env_var:setup.envVar,http_headers:null,env_http_headers:null } }
      entries.set(setup.serverName,entry)
      if(options.installUncertain)throw new ConnectorError('configuration_write_uncertain')
      return fingerprint(entry)
    },
    async remove(setup,hash) {
      if(options.removeUncertain)throw new ConnectorError('configuration_write_uncertain')
      const entry = entries.get(setup.serverName)
      if (!entry) return
      if (!(options.client === 'gemini' ? matchesGeminiEntry : matchesEntry)(entry,setup) || fingerprint(entry)!==hash) throw new ConnectorError('configuration_changed')
      entries.delete(setup.serverName)
    },
    async verify(setup,token) {
      assert.equal(setup.projectId,PROJECT); assert.equal(token,TOKEN); verified++
      if(options.client === 'gemini')return geminiVerification()
      return options.verifyFailure ? { authorized:false,verified:false,code:'verification_discovery_failed' }
        : options.manual ? { authorized:null,verified:false,code:'manual_verification_required' } : { authorized:true,verified:true,code:'verified' }
    },
    async launch(setup,token) {
      assert.equal(setup.projectId,PROJECT); assert.equal(token,TOKEN); launched++
      if (options.modifyConfig) entries.get(setup.serverName).custom = true
      if (options.duringLaunch) await options.duringLaunch()
      if (options.launchFailure) throw new ConnectorError('client_launch_failed')
    },
  }
  const owner = { userId:USER, projects:[project], api:async (route,method='GET',body) => {
    const url = new URL(route,'https://example.invalid')
    calls.push({path:url.pathname,method,body})
    if (url.pathname.endsWith('/project_members')) return [{user_id:USER,role:options.removed?'DEVELOPER':'OWNER'}]
    if (url.pathname.endsWith('/projects')) {
      if (method==='PATCH') { assert.deepEqual(body,{mcp_enabled:true}); project.mcp_enabled=true; return [{id:PROJECT,mcp_enabled:true}] }
      return [project]
    }
    if (url.pathname.endsWith('/issue_mcp_connection_token')) {
      assert.equal(body.p_project_id,PROJECT); assert.equal(body.p_user_id,USER); issued++
      if (!options.unknownIssuance) connection={id:CONNECTION,project_id:PROJECT,user_id:USER,client_label:body.p_client_label,revoked_at:null}
      if (options.lostIssuance || options.unknownIssuance) throw new ConnectorError('request_failed')
      issuanceResponse=[{connection_id:CONNECTION,access_token:TOKEN}]; return issuanceResponse
    }
    if (url.pathname.endsWith('/mcp_connections')) {
      if (options.missingConnection) return []
      if (options.alreadyRevoked && connection) connection.revoked_at='2026-11-02T00:00:00Z'
      if (options.wrongCleanupRow && connection) return [{...connection,id:'44444444-4444-4444-8444-444444444444'}]
      return connection ? [connection] : []
    }
    if (url.pathname.endsWith('/revoke_mcp_connection')) {
      revoked++
      if (options.revokeFailure) throw new ConnectorError('request_failed')
      assert.equal(body.p_connection_id,CONNECTION); connection.revoked_at='2026-11-02T00:00:00Z'; return null
    }
    throw new Error('Unexpected operation')
  } }
  const ui = {say:message=>output.push(message),choose:async()=>0,confirm:async message=>{ approvals.push(message); return options.confirm ? options.confirm(message) : true }}
  const run = () => connect({owner,adapter,store,ui,signal:options.signal})
  return {root,store,adapter,owner,ui,run,output,approvals,entries,calls,unrelated,get issued(){return issued},get revoked(){return revoked},get launched(){return launched},get verified(){return verified},get response(){return issuanceResponse}}
}
test('Owner session previews, uses one token, verifies read access, launches and confirms cleanup; unrelated config is unchanged',async t=>{
  const f=await fixture(t,{enabled:false});await f.run()
  assert.equal(f.issued,1);assert.equal(f.revoked,1);assert.equal(f.verified,1);assert.equal(f.launched,1)
  assert.equal(f.approvals.length,3)
  assert.ok(f.output.some(line=>line.includes('Configured: yes. Authorized: verified. Verified working: yes.')))
  assert.equal(JSON.stringify(f.entries.get('unrelated')),f.unrelated)
  assert.equal(f.response[0].access_token,'')
  assert.deepEqual(await f.store.read(),[])
  assert.ok(!JSON.stringify(f.output).includes(TOKEN))
  assert.ok(!(await readFile(path.join(f.root,'connections.json'),'utf8')).includes(TOKEN))
  assert.equal(f.owner.projects[0].mcp_enabled,true,'explicitly approved project enablement is not silently reversed')
})
for (const stage of ['Install','Enable','Approve']) test('declining '+stage+' does not issue a token or leave a client entry',async t=>{
  const f=await fixture(t,{enabled:false,confirm:message=>!message.startsWith(stage)})
  await f.run();assert.equal(f.issued,0);assert.equal(f.launched,0)
  assert.equal(f.entries.size,1);assert.deepEqual(await f.store.read(),[])
})
test('an unmanaged conflicting server is never overwritten',async t=>{
  const f=await fixture(t),setup=setupFor(PROJECT)
  f.entries.set(setup.serverName,{name:setup.serverName,transport:{type:'stdio',command:'keep-conflict'}})
  await assert.rejects(f.run(),error=>error.code==='configuration_conflict')
  assert.equal(f.issued,0);assert.equal(f.entries.get(setup.serverName).transport.command,'keep-conflict')
})
test('membership loss blocks before configuration or token changes',async t=>{
  const f=await fixture(t,{removed:true})
  await assert.rejects(f.run(),error=>error.code==='owner_required');assert.equal(f.issued,0);assert.equal(f.entries.size,1)
})
for (const option of ['verifyFailure','launchFailure']) test(option+' still revokes, removes config and does not retry issuance',async t=>{
  const f=await fixture(t,{[option]:true})
  await assert.rejects(f.run());assert.equal(f.issued,1);assert.equal(f.revoked,1);assert.equal(f.entries.size,1)
  assert.deepEqual(await f.store.read(),[])
})
test('interruption after launch always enters cleanup',async t=>{
  const stop=new AbortController()
  const f=await fixture(t,{signal:stop.signal,duringLaunch:()=>{stop.abort();throw new ConnectorError('interrupted')}})
  await assert.rejects(f.run(),error=>error.code==='interrupted');assert.equal(f.revoked,1);assert.equal(f.entries.size,1)
})
test('revocation failure leaves only recovery metadata; disconnect reauthenticates and recovers independently',async t=>{
  const options={revokeFailure:true};const f=await fixture(t,options)
  await assert.rejects(f.run(),error=>error.code==='cleanup_unconfirmed')
  const [record]=await f.store.read();assert.equal(record.phase,'revocation_pending');assert.equal(record.connectionId,CONNECTION);assert.equal(record.installed,false)
  assert.ok(!JSON.stringify(record).includes(TOKEN));assert.ok(f.output.some(line=>line.includes('UNCONFIRMED')))
  const repeated=await fixture(t)
  // Repeated setup on the same recovery journal must stop before another issue RPC.
  await assert.rejects(connect({owner:repeated.owner,adapter:repeated.adapter,store:f.store,ui:f.ui}),error=>error.code==='existing_connection_recover_first')
  assert.equal(repeated.issued,0)
  options.revokeFailure=false
  await disconnect(f.store,f.adapter,f.ui,async action=>action(f.owner),PROJECT)
  assert.deepEqual(await f.store.read(),[])
})
test('a lost issuance response is recovered by its unique nonsecret label without reissuing',async t=>{
  const f=await fixture(t,{lostIssuance:true})
  await assert.rejects(f.run());assert.equal(f.issued,1);assert.equal(f.revoked,1);assert.deepEqual(await f.store.read(),[])
})
test('uncertain issuance with no visible row remains unresolved rather than being declared revoked',async t=>{
  const f=await fixture(t,{unknownIssuance:true})
  await assert.rejects(f.run(),error=>error.code==='cleanup_unconfirmed')
  assert.equal(f.revoked,0);assert.equal((await f.store.read())[0].phase,'revocation_pending')
})
test('manual verification fallback never claims authorization or connectivity',async t=>{
  const f=await fixture(t,{manual:true});await f.run()
  assert.ok(f.output.some(line=>line.includes('Authorized: not verified. Verified working: no.')))
  assert.equal(f.launched,1);assert.equal(f.revoked,1)
})
test('user-edited connector configuration survives cleanup, while its token is revoked',async t=>{
  const f=await fixture(t,{modifyConfig:true})
  await assert.rejects(f.run(),error=>error.code==='cleanup_unconfirmed')
  assert.equal(f.revoked,1);assert.equal(f.entries.get(setupFor(PROJECT).serverName).custom,true)
  const [record]=await f.store.read();assert.equal(record.phase,'revoked')
  await status(f.store,f.adapter,f.ui)
  assert.ok(f.output.some(line=>line.includes('changed; not managed safely')))
})
test('status is non-mutating and reports live authorization/connection as unchecked',async t=>{
  const f=await fixture(t);await status(f.store,f.adapter,f.ui)
  assert.ok(f.output[0].includes('Authorized: not checked'))
  assert.equal(f.calls.length,0)
})
for(const option of ['alreadyRevoked','missingConnection'])test('cleanup handles '+option+' without another revocation RPC',async t=>{
  const f=await fixture(t,{[option]:true});await f.run()
  assert.equal(f.revoked,0);assert.deepEqual(await f.store.read(),[])
})
test('unexpected connection identity is not revoked and recovery stays unresolved',async t=>{
  const f=await fixture(t,{wrongCleanupRow:true})
  await assert.rejects(f.run(),error=>error.code==='cleanup_unconfirmed')
  assert.equal(f.revoked,0);assert.equal((await f.store.read())[0].phase,'revocation_pending')
})
test('sign-out failure after a successful independent disconnect is reported, not swallowed',async t=>{
  const options={revokeFailure:true},f=await fixture(t,options)
  await assert.rejects(f.run());options.revokeFailure=false
  await assert.rejects(disconnect(f.store,f.adapter,f.ui,async action=>{
    await action(f.owner);throw new ConnectorError('signout_unconfirmed')
  },PROJECT),error=>error.code==='signout_unconfirmed')
  assert.deepEqual(await f.store.read(),[])
})
test('archived project can still be revoked through independent cleanup',async t=>{
  const options={revokeFailure:true},f=await fixture(t,options)
  await assert.rejects(f.run());options.revokeFailure=false;f.owner.projects[0].archived=true
  await disconnect(f.store,f.adapter,f.ui,async action=>action(f.owner),PROJECT)
  assert.deepEqual(await f.store.read(),[])
})
test('Gemini Owner workflow issues once, launches with manual verification and cleans up without claiming connection success',async t=>{
  const f=await fixture(t,{client:'gemini',enabled:false});await f.run()
  assert.equal(f.issued,1);assert.equal(f.launched,1);assert.equal(f.revoked,1)
  assert.deepEqual(await f.store.read(),[])
  assert.ok(f.output.some(line=>line.startsWith('Launching Gemini.')))
  assert.ok(f.output.some(line=>line.includes('Authorized: not verified. Verified working: no.')))
  assert.ok(f.output.some(line=>line.includes('exactly these five tools')))
  assert.ok(!JSON.stringify(f.output).includes(TOKEN))
  assert.equal(f.owner.projects[0].mcp_enabled,true)
})
function codexRecord(f){return {projectId:PROJECT,userId:USER,client:'codex',executable:f.adapter.executable.path,
  codexHome:path.join(f.root,'codex-home'),clientLabel:'TrackQA Connect 44444444-4444-4444-8444-444444444444',connectionId:null,
  phase:'planned',installed:false,configHash:null,lastVerifiedAt:null}}
test('same-project Codex legacy recovery record survives Gemini connect/cleanup unchanged',async t=>{
  const f=await fixture(t,{client:'gemini'}),record=codexRecord(f)
  await f.store.save(record);await f.run()
  assert.deepEqual(await f.store.read(),[record]);assert.equal(f.revoked,1)
  await status(f.store,f.adapter,f.ui)
  assert.ok(f.output.at(-1).includes('No connector-managed'))
})
test('Gemini interruption revokes only its connection and preserves same-project Codex metadata',async t=>{
  const f=await fixture(t,{client:'gemini',duringLaunch:()=>{throw new ConnectorError('interrupted')}}),record=codexRecord(f)
  await f.store.save(record)
  await assert.rejects(f.run(),e=>e.code==='interrupted')
  assert.deepEqual(await f.store.read(),[record]);assert.equal(f.revoked,1)
})
test('uncertain Gemini revocation retains client-specific metadata and independent disconnect recovers only Gemini',async t=>{
  const options={client:'gemini',revokeFailure:true},f=await fixture(t,options),record=codexRecord(f)
  await f.store.save(record)
  await assert.rejects(f.run(),e=>e.code==='cleanup_unconfirmed')
  const records=await f.store.read(),gemini=records.find(r=>r.client==='gemini')
  assert.equal(records.length,2);assert.equal(gemini.geminiHome,f.adapter.configurationHome)
  assert.equal(gemini.codexHome,undefined);assert.equal(gemini.phase,'revocation_pending')
  assert.equal(gemini.lastVerifiedAt,null);assert.ok(!JSON.stringify(records).includes(TOKEN))
  options.revokeFailure=false
  await disconnect(f.store,f.adapter,f.ui,async action=>action(f.owner),PROJECT)
  assert.deepEqual(await f.store.read(),[record])
})
test('Gemini status/disconnect cannot consume Codex records even for the same project',async t=>{
  const f=await fixture(t,{client:'gemini'}),record=codexRecord(f)
  await f.store.save(record)
  await assert.rejects(disconnect(f.store,f.adapter,f.ui,async()=>{throw new Error('No authentication expected')},PROJECT),e=>e.code==='no_managed_connections')
  assert.deepEqual(await f.store.read(),[record]);assert.equal(f.calls.length,0)
})
test('uncertain Gemini local removal retains revoked recovery metadata and never issues again',async t=>{
  const options={client:'gemini',removeUncertain:true},f=await fixture(t,options),other=codexRecord(f)
  await f.store.save(other)
  await assert.rejects(f.run(),e=>e.code==='cleanup_unconfirmed')
  const record=(await f.store.read()).find(row=>row.client==='gemini')
  assert.equal(record.phase,'revoked');assert.equal(record.installed,true);assert.equal(record.connectionId,CONNECTION)
  assert.equal(f.issued,1);assert.equal(f.revoked,1)
  assert.ok(f.output.some(line=>line.includes('.trackqa-settings-recovery-*.bak')))
  options.removeUncertain=false
  await disconnect(f.store,f.adapter,f.ui,async()=>{throw new Error('Already revoked: no sign-in needed')},PROJECT)
  assert.deepEqual(await f.store.read(),[other]);assert.equal(f.issued,1)
})
test('uncertain Gemini installation cannot issue credentials and preserves metadata until manually reconciled',async t=>{
  const f=await fixture(t,{client:'gemini',installUncertain:true})
  await assert.rejects(f.run(),e=>e.code==='cleanup_unconfirmed')
  const [record]=await f.store.read()
  assert.equal(record.client,'gemini');assert.equal(record.phase,'planned');assert.equal(record.configHash,null)
  assert.equal(record.connectionId,null);assert.equal(f.issued,0);assert.equal(f.launched,0)
  assert.ok(f.output.some(line=>line.includes('never restore over an unexpected external edit')))
  // Simulate the user's separate review/removal; the connector must not guess
  // ownership of an installation whose fingerprint was never acknowledged.
  f.entries.delete(setupFor(PROJECT,'gemini').serverName)
  await disconnect(f.store,f.adapter,f.ui,async()=>{throw new Error('No credentials were issued')},PROJECT)
  assert.deepEqual(await f.store.read(),[])
})

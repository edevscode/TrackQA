import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseHostedArgs, main as hostedMain } from './copilot-hosted.mjs'
import { withOwner } from '../src/auth.ts'
import { Store } from '../src/state.ts'
import { ConnectorError, setupFor, SUPABASE_URL } from '../src/core.ts'
import { connect, connectCopilotFixture } from '../src/workflow.ts'
import { vscodeCopilotAdapter } from '../src/clients/vscode-copilot.ts'
import { freshCopilotHome } from '../src/clients/vscode-copilot-session.ts'
import { COPILOT_FIXTURE as FIXTURE, FIXTURE_POLICY, createFixtureScope, fixtureMembershipRoute, fixtureRequestAllowed,
  fixtureScopeState, observeFixtureResponse, grantFixturePermit, consumeFixturePermit } from '../src/testing/copilot-fixture-scope.ts'
import { runCopilotHostedAcceptance, recoverCopilotHostedAcceptance, copilotHostedRecoveryBase } from '../src/testing/copilot-hosted.ts'
import { copilotHostedPathBudget, COPILOT_SQLITE_PATH_BUDGET, freshHostedCopilotHome, hostedCopilotRecoveryHome } from '../src/testing/copilot-hosted-paths.ts'
import { HostedAcceptanceTiming, HOSTED_WINDOW_MS, HOSTED_MIN_EXECUTION_MS } from '../src/testing/copilot-hosted-timing.ts'
const USER='22222222-2222-4222-8222-222222222222',CONNECTION='33333333-3333-4333-8333-333333333333',ISSUE='44444444-4444-4444-8444-444444444444'
const TOKEN='tqm_'+'c'.repeat(64),setup=setupFor(FIXTURE.id,'vscode-copilot')
async function fixture(t,options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'tq-'))
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(/^tq-[A-Za-z0-9]{6}$/.test(path.basename(root)));await rm(root,{recursive:true,force:true})})
  const store=new Store(root),homeBase=store.root,scope=createFixtureScope(),calls=[],messages=[],spawned=[]
  const project={...FIXTURE,mcp_enabled:!!options.enabled,archived:!!options.archived}
  if(options.wrongName)project.name='Different project';if(options.wrongKey)project.key='DIFFERENT'
  if(options.wrongId)project.id=USER
  const issues=[{id:ISSUE,project_id:FIXTURE.id,number:2,status:'OPEN',description:'Untrusted data; never interpreted'}],findings=[]
  let row=options.existingConnection?{id:CONNECTION,project_id:FIXTURE.id,user_id:USER,client_label:'unrelated',revoked_at:null}:null
  let issueResponse,issued=0,revocations=0,approvalCount=0
  const exe={path:path.join(root,'Code.exe'),installation:root,sha256:'a'.repeat(64),version:'1.143.1',appServer:false,foregroundMode:'direct',inputs:[]}
  const child=new EventEmitter();child.unref=()=>{};child.kill=()=>assert.fail('Never kill a client')
  const runtime={verify:async()=>{},spawn:(file,args,opts)=>{spawned.push({file,args,env:{...opts.env}});if(options.launchFailure)throw new Error(TOKEN);return child}}
  async function raw(route,method='GET',body){
    calls.push({route,method,body})
    await options.onCall?.({route,method,body})
    const url=new URL(route,'https://example.invalid'),resource=url.pathname.split('/').at(-1)
    if(resource==='project_members')return[{user_id:USER,role:options.notOwner?'DEVELOPER':'OWNER'}]
    if(resource==='projects'){
      if(method==='PATCH'){
        project.mcp_enabled=body.mcp_enabled
        if(body.mcp_enabled&&options.enableFailure)throw new ConnectorError('request_failed')
        if(!body.mcp_enabled&&options.restoreFailure)throw new ConnectorError('request_failed')
        return[{id:FIXTURE.id,mcp_enabled:project.mcp_enabled}]
      }
      return[{...project}]
    }
    if(resource==='issues'||resource==='ai_findings')return structuredClone((resource==='issues'?issues:findings).slice(Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('offset')??0)+100))
    if(resource==='mcp_connections'){
      if(url.searchParams.get('revoked_at')==='is.null')return row&&!row.revoked_at?[{...row}]:[]
      return row?[{...row}]:[]
    }
    if(resource==='issue_mcp_connection_token'){
      issued++;row={id:CONNECTION,project_id:FIXTURE.id,user_id:USER,client_label:body.p_client_label,revoked_at:null}
      if(options.lostIssuance)throw new ConnectorError('request_failed')
      issueResponse=[{connection_id:CONNECTION,access_token:TOKEN}];return issueResponse
    }
    if(resource==='revoke_mcp_connection'){
      revocations++;if(options.revokeFailure)throw new ConnectorError('request_failed')
      assert.equal(body.p_connection_id,CONNECTION);row.revoked_at='synthetic-revoked';return null
    }
    assert.fail('Unexpected fixture API operation')
  }
  const makeOwner=currentScope=>({userId:USER,projects:[project],api:async(route,method='GET',body)=>{
    assert.equal(fixtureRequestAllowed(currentScope,USER,route,method,body),true,'Fixture API scope rejected operation')
    const result=await raw(route,method,body);observeFixtureResponse(currentScope,USER,route,result);return result
  }})
  const owner=makeOwner(scope)
  const ui={say:m=>messages.push(m),choose:async()=>assert.fail('No arbitrary project selection'),confirm:async message=>{
    approvalCount++;assert.ok(message.startsWith('Approve this revised policy'))
    assert.equal(calls.some(c=>c.method!=='GET'),false)
    assert.ok(calls.some(c=>c.route.includes('/issues?'))&&calls.some(c=>c.route.includes('/ai_findings?')))
    if(options.afterApproval)await options.afterApproval({project,issues,scope,store})
    return options.approve!==false
  }}
  const requestDisconnect=async()=>{
    if(options.inventoryChanged)issues[0].status='CLOSED'
    if(options.interrupt)options.interrupt.abort()
    await options.onDisconnect?.()
  }
  const run=()=>runCopilotHostedAcceptance({owner,scope,store,homeBase,exe,ui,requestDisconnect,runtime,signal:options.interrupt?.signal,timing:options.timing})
  return{root,store,homeBase,scope,owner,makeOwner,run,exe,runtime,ui,options,project,issues,calls,messages,spawned,
    journal:path.join(store.root,'copilot-fixture-acceptance.json'),get issued(){return issued},get revocations(){return revocations},get approvals(){return approvalCount},get response(){return issueResponse}}
}
test('entry point accepts only explicit fixture mode and has no project/client/token overrides',()=>{
  assert.deepEqual(parseHostedArgs(['--fixture-hosted-copilot']),{recover:false})
  assert.deepEqual(parseHostedArgs(['--fixture-hosted-copilot','--recover']),{recover:true})
  for(const args of [[],['connect'],['--fixture-hosted-copilot','--project',USER],['--fixture-hosted-copilot','--client','codex'],['--fixture-hosted-copilot','--token','secret'],['--fixture-hosted-copilot','--recover','--vscode-path','x']])assert.throws(()=>parseHostedArgs(args))
})
test('only hosted acceptance uses the compact, unique connector-owned UUID layout',async t=>{
  const f=await fixture(t),a=freshHostedCopilotHome(f.store.root),b=freshHostedCopilotHome(f.store.root)
  assert.notEqual(a,b);assert.equal(path.dirname(a),f.store.root);assert.match(path.basename(a),/^[a-f0-9-]{36}$/)
  assert.equal(hostedCopilotRecoveryHome(f.store.root,a),a)
  assert.ok(copilotHostedPathBudget(a).journal<=240)
  const old=freshCopilotHome(path.join(f.store.root,'vscode-copilot-sessions'))
  assert.equal(path.basename(path.dirname(old)),'runs')
  assert.throws(()=>copilotHostedPathBudget(old),e=>e.code==='fixture_path_budget_exceeded')
})
test('SQLite budget includes rollback, WAL and SHM paths with 20 characters of headroom',()=>{
  const drive=path.parse(os.tmpdir()).root,base=path.join(drive,'r'.repeat(47-drive.length))
  const budget=copilotHostedPathBudget(freshHostedCopilotHome(base))
  assert.deepEqual(budget,{main:232,journal:240,wal:236,shm:236,budget:240})
  assert.equal(260-COPILOT_SQLITE_PATH_BUDGET,20)
  assert.throws(()=>copilotHostedPathBudget(freshHostedCopilotHome(base+'x')),e=>e.code==='fixture_path_budget_exceeded')
  assert.throws(()=>freshHostedCopilotHome('relative'))
})
test('oversized hosted root fails before any Owner access, prompt, launch or hosted mutation',async t=>{
  const f=await fixture(t),forbidden=new Proxy({},{get(){assert.fail('Path preflight must happen before Owner/UI access')}})
  await assert.rejects(runCopilotHostedAcceptance({owner:forbidden,scope:f.scope,store:f.store,homeBase:path.join(f.root,'x'.repeat(100)),exe:f.exe,ui:forbidden,requestDisconnect:async()=>assert.fail('No launch'),runtime:f.runtime}),e=>e.code==='fixture_path_budget_exceeded')
  assert.equal(f.calls.length,0);assert.equal(f.spawned.length,0);await assert.rejects(access(f.journal))
})
test('actual entry refuses a long root before authentication, native detection or a consent prompt',async t=>{
  const f=await fixture(t),data=path.join(f.root,'long-'+ 'x'.repeat(100)),previousData=process.env.LOCALAPPDATA,previousExit=process.exitCode
  const stdinTTY=Object.getOwnPropertyDescriptor(process.stdin,'isTTY'),stdoutTTY=Object.getOwnPropertyDescriptor(process.stdout,'isTTY'),write=process.stdout.write
  let output=''
  try{
    process.env.LOCALAPPDATA=data
    Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true})
    Object.defineProperty(process.stdout,'isTTY',{value:true,configurable:true})
    process.stdout.write=function(chunk,...args){output+=String(chunk);const done=args.at(-1);if(typeof done==='function')done();return true}
    await hostedMain(['--fixture-hosted-copilot','--vscode-path',path.join(f.root,'not-installed.exe')])
  }finally{
    process.stdout.write=write
    if(stdinTTY)Object.defineProperty(process.stdin,'isTTY',stdinTTY);else delete process.stdin.isTTY
    if(stdoutTTY)Object.defineProperty(process.stdout,'isTTY',stdoutTTY);else delete process.stdout.isTTY
    if(previousData===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previousData
    process.exitCode=previousExit
  }
  assert.match(output,/fixture_path_budget_exceeded/);assert.equal(output.includes('Start Google'),false)
  await assert.rejects(access(data))
})
test('recovery resolves compact and legacy layouts without moving or rewriting saved evidence',async t=>{
  const f=await fixture(t),legacyBase=path.join(f.store.root,'vscode-copilot-sessions')
  for(const[home,expected]of[[freshHostedCopilotHome(f.store.root),f.store.root],[freshCopilotHome(legacyBase),legacyBase]]){
    const evidence=JSON.stringify({home});await writeFile(f.journal,evidence)
    assert.equal(await copilotHostedRecoveryBase(f.store,legacyBase),expected)
    assert.equal(await readFile(f.journal,'utf8'),evidence)
  }
  await writeFile(f.journal,JSON.stringify({home:path.join(f.root,'foreign','00000000-0000-4000-8000-000000000000')}))
  await assert.rejects(copilotHostedRecoveryBase(f.store,legacyBase),e=>e.code==='fixture_recovery_invalid')
  assert.throws(()=>hostedCopilotRecoveryHome(f.store.root,f.store.root))
})
for(const failure of ['wrongName','wrongKey','wrongId','archived','enabled','notOwner','existingConnection'])test('fresh preflight fails before approval or mutation: '+failure,async t=>{
  const f=await fixture(t,{[failure]:true});await assert.rejects(f.run())
  assert.equal(f.approvals,0);assert.equal(f.issued,0);assert.equal(f.calls.some(c=>c.method!=='GET'),false);await assert.rejects(access(f.journal))
})
test('revised-policy refusal never installs config, enables MCP or issues a token',async t=>{
  const f=await fixture(t,{approve:false});assert.deepEqual(await f.run(),{approved:false})
  assert.equal(f.approvals,1);assert.equal(f.spawned.length,0);assert.equal(f.calls.some(c=>c.method!=='GET'),false)
  assert.ok(f.messages.includes(FIXTURE_POLICY));await assert.rejects(access(f.journal))
})
test('preflight is repeated after approval; changed inventory cancels before mutation',async t=>{
  const f=await fixture(t,{afterApproval:({issues})=>{issues[0].status='CHANGED'}})
  await assert.rejects(f.run(),e=>e.code==='fixture_preflight_changed')
  assert.equal(f.approvals,1);assert.equal(f.calls.some(c=>c.method!=='GET'),false)
})
test('pending recovery evidence blocks a new connection before hosted preflight',async t=>{
  const f=await fixture(t);await f.store.prepare();await writeFile(f.journal,'{"preserve":true}')
  await assert.rejects(f.run(),e=>e.code==='fixture_recovery_required');assert.equal(f.calls.length,0)
  assert.equal(await readFile(f.journal,'utf8'),'{"preserve":true}')
})
test('normal guards reject Copilot and a forged or mismatched fixture permit cannot activate another client',async t=>{
  const f=await fixture(t),adapter=vscodeCopilotAdapter(f.exe,path.join(f.homeBase,'normal'))
  const forbidden=new Proxy({},{get(){assert.fail('No authentication/hosted reads')}})
  await assert.rejects(connect({adapter,owner:forbidden,store:forbidden,ui:forbidden}),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(adapter.prepare(),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(adapter.launch(setup,TOKEN),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(connectCopilotFixture({permit:{},owner:f.owner,adapter,store:f.store,ui:f.ui}),e=>e.code==='fixture_capability_invalid')
  assert.throws(()=>grantFixturePermit(f.scope,f.owner,{...adapter,client:'codex'},f.store))
  const permit=grantFixturePermit(f.scope,f.owner,adapter,f.store)
  assert.throws(()=>consumeFixturePermit(permit,{...f.owner},adapter,f.store))
  await assert.rejects(connectCopilotFixture({permit,owner:f.owner,adapter,store:f.store,ui:f.ui,projectId:USER}),e=>e.code==='fixture_identity_mismatch')
})
test('one approved run reuses issuance, native launch and actual Disconnect; restores baseline without storing tokens',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.run(),{approved:true})
  assert.equal(f.approvals,1);assert.equal(f.issued,1);assert.equal(f.revocations,1);assert.equal(f.spawned.length,1)
  assert.equal(f.spawned[0].env[setup.envVar],TOKEN);assert.equal(JSON.stringify(f.spawned[0].args).includes(TOKEN),false)
  assert.equal(f.project.mcp_enabled,false);assert.equal(f.response[0].access_token,'');assert.deepEqual(await f.store.read(),[])
  assert.deepEqual(f.calls.filter(c=>c.method==='PATCH').map(c=>c.body),[{mcp_enabled:true},{mcp_enabled:false}])
  const revIndex=f.calls.findIndex(c=>c.route.endsWith('/revoke_mcp_connection'))
  assert.ok(f.calls.slice(revIndex+1).some(c=>c.route.includes('/mcp_connections?')&&!c.route.includes('revoked_at=')))
  assert.ok(f.messages.some(m=>m.startsWith('Disconnect:')));assert.ok(f.messages.some(m=>m.includes('inventories unchanged')))
  await assert.rejects(access(f.journal))
  const home=f.spawned[0].env.COPILOT_HOME,profile=path.dirname(home)
  await assert.rejects(access(path.join(home,'mcp-config.json')))
  for(const name of ['owner.json','launch.json','user-data/User/settings.json'])assert.equal((await readFile(path.join(profile,name),'utf8')).includes(TOKEN),false)
  assert.equal((await readFile(path.join(f.store.root,'connections.json'),'utf8')).includes(TOKEN),false)
  assert.equal(fixtureRequestAllowed(f.scope,USER,'/rest/v1/rpc/issue_mcp_connection_token','POST',{p_project_id:FIXTURE.id,p_user_id:USER,p_client_label:'TrackQA Connect '+ISSUE}),false)
})
test('fixture capability is one-use and its API cannot enable or issue for another project or account',async t=>{
  const f=await fixture(t),adapter=vscodeCopilotAdapter(f.exe,path.join(f.homeBase,'test'))
  const permit=grantFixturePermit(f.scope,f.owner,adapter,f.store)
  assert.throws(()=>grantFixturePermit(f.scope,f.owner,adapter,f.store))
  assert.throws(()=>consumeFixturePermit(permit,f.owner,adapter,new Store(path.join(f.root,'other'))))
  consumeFixturePermit(permit,f.owner,adapter,f.store)
  assert.throws(()=>consumeFixturePermit(permit,f.owner,adapter,f.store))
  for(const [route,method,body]of [[`/rest/v1/projects?id=eq.${USER}&select=id,mcp_enabled`,'PATCH',{mcp_enabled:true}],
    ['/rest/v1/rpc/issue_mcp_connection_token','POST',{p_project_id:USER,p_user_id:USER,p_client_label:'TrackQA Connect '+ISSUE}],
    ['/rest/v1/rpc/issue_mcp_connection_token','POST',{p_project_id:FIXTURE.id,p_user_id:ISSUE,p_client_label:'TrackQA Connect '+ISSUE}],
    ['/rest/v1/rpc/revoke_mcp_connection','POST',{p_connection_id:ISSUE}]])assert.equal(fixtureRequestAllowed(f.scope,USER,route,method,body),false)
  assert.equal(fixtureRequestAllowed(f.scope,USER,`/rest/v1/projects?id=eq.${FIXTURE.id}&select=id,mcp_enabled`,'PATCH',{mcp_enabled:true}),true)
  assert.equal(fixtureRequestAllowed(f.scope,USER,`/rest/v1/projects?id=eq.${FIXTURE.id}&select=id,mcp_enabled`,'PATCH',{mcp_enabled:true}),false)
})
test('interruption before approval does not read hosted state; interruption after approval does not mutate it',async t=>{
  const first=new AbortController();first.abort();const a=await fixture(t,{interrupt:first});await assert.rejects(a.run(),e=>e.code==='unknown_interruption');assert.equal(a.calls.length,0)
  const stop=new AbortController(),b=await fixture(t,{interrupt:stop,afterApproval:()=>stop.abort()})
  await assert.rejects(b.run(),e=>e.code==='unknown_interruption');assert.equal(b.calls.some(c=>c.method!=='GET'),false)
})
test('interrupted native wait still revokes and restores without killing the client',async t=>{
  const f=await fixture(t,{interrupt:new AbortController()})
  await assert.rejects(f.run(),e=>e.code==='unknown_interruption');assert.equal(f.issued,1);assert.equal(f.revocations,1);assert.equal(f.project.mcp_enabled,false)
  assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.journal))
})
for(const failure of ['enableFailure','launchFailure','lostIssuance'])test('failed stage uses shared cleanup and restores a possibly committed enablement: '+failure,async t=>{
  const f=await fixture(t,{[failure]:true});await assert.rejects(f.run())
  assert.equal(f.project.mcp_enabled,false);assert.equal(f.issued,failure==='enableFailure'?0:1)
  assert.equal(f.revocations,failure==='enableFailure'?0:1);assert.deepEqual(await f.store.read(),[])
  await assert.rejects(access(f.journal))
})
test('failed revocation preserves both recovery records; recovery can revoke but cannot issue or enable',async t=>{
  const f=await fixture(t,{revokeFailure:true});await assert.rejects(f.run(),e=>e.code==='fixture_cleanup_unconfirmed')
  assert.equal(f.revocations,1);assert.equal(f.project.mcp_enabled,false)
  const [pending]=await f.store.read();assert.equal(pending.phase,'revocation_pending')
  const saved=await readFile(f.journal,'utf8');assert.equal(saved.includes(TOKEN),false)
  await assert.rejects(f.run());assert.equal(await readFile(f.journal,'utf8'),saved)
  f.options.revokeFailure=false;const scope=createFixtureScope()
  await recoverCopilotHostedAcceptance({owner:f.makeOwner(scope),scope,store:f.store,homeBase:f.homeBase,ui:{...f.ui,confirm:async()=>true}})
  assert.equal(f.issued,1);assert.equal(f.project.mcp_enabled,false);assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.journal))
})
test('restoration uncertainty retains the journal even when revocation succeeded and configuration is gone',async t=>{
  const f=await fixture(t,{restoreFailure:true});await assert.rejects(f.run(),e=>e.code==='fixture_cleanup_unconfirmed')
  assert.deepEqual(await f.store.read(),[]);await access(f.journal)
  const scope=createFixtureScope();f.options.restoreFailure=false
  await recoverCopilotHostedAcceptance({owner:f.makeOwner(scope),scope,store:f.store,homeBase:f.homeBase,ui:{...f.ui,confirm:async()=>true}})
  assert.equal(f.issued,1);await assert.rejects(access(f.journal))
})
test('inventory changes are reported and preserved for human review, never automatically repaired',async t=>{
  const f=await fixture(t,{inventoryChanged:true});await assert.rejects(f.run(),e=>e.code==='fixture_cleanup_unconfirmed')
  assert.equal(f.issues[0].status,'CLOSED');assert.equal(f.project.mcp_enabled,false)
  assert.equal(f.calls.some(c=>c.method!=='GET'&&(/\/issues\?|\/ai_findings\?/.test(c.route))),false)
  await access(f.journal);assert.deepEqual(await f.store.read(),[])
})
test('scoped Owner PKCE reuses the auth transport, permits only fixture reads before approval and signs out',async()=>{
  const scope=createFixtureScope(),calls=[],session={access_token:'synthetic-human-access',refresh_token:'synthetic-refresh'}
  let signedOut=0,settings
  await withOwner({key:'sb_publishable_synthetic',fixtureScope:scope,
    makeClient:(_url,_key,value)=>{settings=value;return{auth:{getUser:async()=>({data:{user:{id:USER,factors:[]}}}),signOut:async()=>{signedOut++;return{error:null}}}}},
    signIn:async()=>({data:{session,user:{id:USER}},error:null}),
    fetch:async(input,init)=>{
      const url=new URL(input);assert.equal(url.origin,SUPABASE_URL);assert.equal(init.redirect,'error');assert.equal(init.method,'GET');calls.push(url.pathname+url.search)
      if(url.pathname.endsWith('/profiles'))return Response.json([{id:USER}])
      if(url.pathname.endsWith('/project_members')){assert.equal(url.searchParams.get('project_id'),'eq.'+FIXTURE.id);return Response.json([{project_id:FIXTURE.id,role:'OWNER',project:{...FIXTURE,mcp_enabled:false,archived:false}}])}
      if(url.pathname.endsWith('/issues'))return Response.json([])
      assert.fail('Unexpected transport call')
    },
  },async owner=>{
    assert.deepEqual(owner.projects.map(p=>p.id),[FIXTURE.id]);const before=calls.length
    for(const[route,method,body]of [[`/rest/v1/projects?id=eq.${FIXTURE.id}&select=id,mcp_enabled`,'PATCH',{mcp_enabled:true}],['/rest/v1/rpc/issue_mcp_connection_token','POST',{}],[`/rest/v1/issues?project_id=eq.${USER}&select=*`,'GET'],['/rest/v1/project_members?select=*','GET']])await assert.rejects(owner.api(route,method,body))
    assert.equal(calls.length,before)
    await owner.api(`/rest/v1/issues?project_id=eq.${FIXTURE.id}&select=*&order=id.asc&limit=100&offset=0`)
    assert.ok(calls.includes(fixtureMembershipRoute(USER)))
  })
  assert.equal(signedOut,1);assert.equal(settings.auth.persistSession,false);assert.equal(session.access_token,'');assert.equal(session.refresh_token,'')
  assert.throws(()=>fixtureScopeState({}));assert.equal(fixtureScopeState(scope).active,false)
})

function timed(t) {
  let now=Date.parse('2026-01-01T00:00:00Z'),expire,delay
  const events=[]
  const timing=new HostedAcceptanceTiming({now:()=>now,emit:event=>events.push(event),
    schedule:(callback,ms)=>{expire=callback;delay=ms;return {fixture:true}},cancel:()=>{}})
  t.after(()=>timing.dispose())
  return {timing,events,advance:ms=>{now+=ms},expire:()=>expire(),get delay(){return delay}}
}

test('deadline retains its original 25-minute anchor and attributes expiration',t=>{
  const f=timed(t);f.timing.establishDeadline();assert.equal(f.delay,25*60_000)
  f.advance(45_000);f.timing.establishDeadline()
  assert.equal(f.events.filter(e=>e.event==='deadline_established').length,1)
  assert.equal(f.events[0].deadlineAt,'2026-01-01T00:25:00.000Z')
  f.advance(20*60_000-45_000);f.timing.check()
  assert.equal(f.timing.signal.aborted,false,'Minute 20 is the operational Disconnect target, not a second deadline')
  f.advance(5*60_000);f.expire()
  assert.equal(f.timing.signal.aborted,true);assert.equal(f.timing.abortReason,'deadline_expired')
  assert.throws(()=>f.timing.check(),e=>e.code==='deadline_expired')
  assert.deepEqual(f.events.at(-1),{event:'first_abort',at:'2026-01-01T00:25:00.000Z',reason:'deadline_expired',duringCleanup:false})
})

for(const reason of ['sigint_received','sigterm_received','controller_aborted'])test('controller attributes '+reason+' without raw signal errors',t=>{
  const f=timed(t);f.timing.abort(reason)
  assert.equal(f.timing.classify(new ConnectorError('interrupted')).code,reason)
  const native=new Error('Synthetic exception must never reach the timing journal');native.name='AbortError'
  assert.equal(f.timing.classify(native).code,reason)
  assert.equal(JSON.stringify(f.events).includes(native.message),false)
})

test('unattributed interruption is explicit and first abort survives later cleanup signals',t=>{
  const f=timed(t);f.timing.classify(new ConnectorError('interrupted'));f.timing.cleanupStart()
  f.timing.abort('sigterm_received');f.timing.abort('deadline_expired');f.timing.cleanupComplete(true)
  assert.equal(f.timing.abortReason,'unknown_interruption')
  assert.equal(f.events.filter(e=>e.event==='first_abort').length,1)
  assert.equal(f.timing.classify(new ConnectorError('fixture_cleanup_unconfirmed')).code,'fixture_cleanup_unconfirmed')
})

test('execution budget fails at less than fourteen minutes and records remaining time',t=>{
  const f=timed(t);assert.throws(()=>f.timing.requireBudget('before_mutation'),e=>e.code==='fixture_timing_unavailable')
  f.timing.establishDeadline();f.advance(HOSTED_WINDOW_MS-HOSTED_MIN_EXECUTION_MS)
  f.timing.requireBudget('before_launch');assert.equal(f.events.at(-1).remainingMs,HOSTED_MIN_EXECUTION_MS)
  f.advance(1);assert.throws(()=>f.timing.requireBudget('before_mutation'),e=>e.code==='insufficient_execution_budget')
  // A delayed timer callback cannot authorize operations beyond the deadline.
  f.advance(HOSTED_WINDOW_MS);assert.throws(()=>f.timing.requireBudget('before_launch'),e=>e.code==='deadline_expired')
})

test('slow approval fails before any mutation, issuance, launch or recovery journal',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing,afterApproval:()=>clock.advance(HOSTED_WINDOW_MS-HOSTED_MIN_EXECUTION_MS+1)})
  await assert.rejects(f.run(),e=>e.code==='insufficient_execution_budget')
  assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.equal(f.issued,0);assert.equal(f.spawned.length,0)
  await assert.rejects(access(f.journal));assert.deepEqual(await f.store.read(),[])
  assert.deepEqual(clock.events.slice(0,7).map(e=>e.event),['preflight_start','preflight_complete','deadline_established','approval_requested','approval_received','preflight_start','preflight_complete'])
})

test('budget is checked again at enablement even if initial budget passed',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing})
  let advanced=false
  f.options.onCall=async()=>{if(!advanced&&clock.events.some(e=>e.event==='budget_checked')){advanced=true;clock.advance(HOSTED_WINDOW_MS-HOSTED_MIN_EXECUTION_MS+1)}}
  await assert.rejects(f.run(),e=>e.code==='insufficient_execution_budget')
  assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.equal(f.issued,0);assert.equal(f.project.mcp_enabled,false)
  assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.journal))
})

test('expired native wait still revokes independently and restores before reporting deadline',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing,onDisconnect:()=>{clock.advance(HOSTED_WINDOW_MS);clock.expire()}})
  await assert.rejects(f.run(),e=>e.code==='deadline_expired')
  assert.equal(f.issued,1);assert.equal(f.revocations,1);assert.equal(f.project.mcp_enabled,false)
  assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.journal))
  const first=clock.events.findIndex(e=>e.event==='first_abort'),cleanup=clock.events.findIndex(e=>e.event==='cleanup_start')
  assert.ok(first<cleanup);assert.deepEqual(clock.events.at(-1).confirmed,true)
  assert.ok(f.messages.some(m=>m.includes('inventories unchanged')))
})

test('signal during cleanup is retained without cancelling revocation or restoration',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing})
  f.options.onCall=async({route})=>{if(route.endsWith('/revoke_mcp_connection')){
    clock.advance(HOSTED_WINDOW_MS-1000);clock.timing.abort('sigterm_received')
    clock.advance(2000);clock.expire();clock.timing.abort('sigint_received')
  }}
  await assert.rejects(f.run(),e=>e.code==='sigterm_received')
  assert.equal(f.revocations,1);assert.equal(f.project.mcp_enabled,false);assert.deepEqual(await f.store.read(),[])
  const event=clock.events.find(e=>e.event==='first_abort');assert.equal(event.duringCleanup,true)
  assert.equal(event.reason,'sigterm_received');assert.equal(clock.events.at(-1).confirmed,true)
  assert.equal(clock.events.at(-1).at,'2026-01-01T00:25:01.000Z','Managed cleanup continues past the controller deadline')
  await assert.rejects(access(f.journal))
})

test('failed revocation preserves recovery and cleanup failure separately from the first abort',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing,revokeFailure:true,onDisconnect:()=>clock.timing.abort('sigint_received')})
  await assert.rejects(f.run(),e=>e.code==='fixture_cleanup_unconfirmed')
  assert.equal(clock.timing.abortReason,'sigint_received');assert.equal(clock.events.at(-1).confirmed,false)
  assert.equal((await f.store.read())[0].phase,'revocation_pending');await access(f.journal)
  assert.equal(f.project.mcp_enabled,false)
})

test('readiness timestamps are manual observations and contain neither tokens nor API data',async t=>{
  const clock=timed(t),f=await fixture(t,{timing:clock.timing,onDisconnect:()=>{
    clock.timing.observeReadiness('copilot_ready');clock.advance(1);clock.timing.observeReadiness('mcp_running_five_tools')
  }})
  await f.run()
  const launch=clock.events.findIndex(e=>e.event==='launch_start'),observations=clock.events.filter(e=>e.event==='native_readiness_observed')
  assert.ok(launch>0);assert.equal(clock.events[launch-1].stage,'before_launch')
  assert.deepEqual(observations.map(e=>e.source),['manual_report','manual_report'])
  assert.equal(JSON.stringify(clock.events).includes(TOKEN),false);assert.equal(JSON.stringify(clock.events).includes(USER),false)
  assert.equal(clock.events.filter(e=>e.event==='deadline_established').length,1)
})

test('timing persistence failure aborts safely but never skips existing access cleanup',async t=>{
  let fail=false
  const timing=new HostedAcceptanceTiming({emit:()=>{if(fail)throw new Error('synthetic disk failure')}})
  t.after(()=>timing.dispose())
  const f=await fixture(t,{timing,onDisconnect:()=>{fail=true;timing.observeReadiness('copilot_ready')}})
  await assert.rejects(f.run(),e=>e.code==='controller_aborted')
  assert.equal(f.revocations,1);assert.equal(f.project.mcp_enabled,false);assert.deepEqual(await f.store.read(),[])
  await assert.rejects(access(f.journal))
})

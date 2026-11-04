import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setupFor, ConnectorError } from '../src/core.ts'
import { Store } from '../src/state.ts'
import { cleanup, disconnect } from '../src/workflow.ts'
import { startCopilotSession } from '../src/clients/vscode-copilot-lifecycle.ts'
import { copilotPaths, installCopilotSession, removeCopilotSession } from '../src/clients/vscode-copilot-session.ts'
import { vscodeCopilotAdapter } from '../src/clients/vscode-copilot.ts'
const PROJECT='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222',CONNECTION='33333333-3333-4333-8333-333333333333'
const setup=setupFor(PROJECT,'vscode-copilot'),TOKEN='tqm_'+'b'.repeat(64)
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
async function fixture(t,mode='session') {
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-copilot-session-'))
  t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('trackqa-copilot-session-'));await rm(root,{recursive:true,force:true})})
  const home=path.join(root,'profiles'),exe={path:path.join(root,'Code.exe'),sha256:'a'.repeat(64),version:'1.143.1',appServer:false,foregroundMode:'direct',inputs:[],installation:root}
  const hash=await installCopilotSession(home,setup,mode),files=copilotPaths(home,setup),calls=[]
  const child=new EventEmitter();child.unref=()=>{calls.push('unref')};child.kill=()=>assert.fail('Never terminate the client')
  const runtime={verify:async value=>{assert.equal(value,exe);calls.push('verify')},spawn:(command,args,options)=>{calls.push({command,args,env:{...options.env},options});return child}}
  const options={runtime,source:{PATH:'safe',GH_TOKEN:'do-not-inherit'},...(mode==='session'?{credential:TOKEN}:{})}
  const begin=()=>startCopilotSession(exe,home,setup,options)
  const store=new Store(path.join(root,'recovery')),messages=[]
  const adapter=vscodeCopilotAdapter(exe,home,{requestDisconnect:async()=>{},report:m=>messages.push(m)})
  const record={projectId:PROJECT,userId:USER,client:'vscode-copilot',vscodeCopilotHome:home,executable:exe.path,clientLabel:'TrackQA Connect 44444444-4444-4444-8444-444444444444',connectionId:CONNECTION,phase:'active',installed:true,lastVerifiedAt:null,configHash:hash}
  let revoked=false;const apiCalls=[]
  const owner={userId:USER,api:async(route,method='GET',body)=>{
    apiCalls.push({route,method,body})
    if(route.startsWith('/rest/v1/project_members'))return[{user_id:USER,role:'OWNER'}]
    if(route.startsWith('/rest/v1/projects')){assert.equal(method,'GET');return[{id:PROJECT,name:'Synthetic',key:'SYNTH',archived:false,mcp_enabled:true}]}
    if(route.startsWith('/rest/v1/mcp_connections'))return[{id:CONNECTION,project_id:PROJECT,user_id:USER,client_label:record.clientLabel,revoked_at:revoked?'synthetic':null}]
    if(route.endsWith('/revoke_mcp_connection')){assert.equal(method,'POST');assert.deepEqual(body,{p_connection_id:CONNECTION});revoked=true;return null}
    assert.fail('Unexpected hosted operation')
  }}
  return{root,home,exe,hash,files,calls,child,runtime,options,begin,store,adapter,record,owner,apiCalls,messages}
}
const ui={say(){},confirm:async()=>true,choose:async()=>0}

test('explicit Disconnect ends CLI wait without closing or supervising the GUI',async t=>{
  const f=await fixture(t),session=await f.begin(),button=deferred(),started=deferred()
  let completed=false,promptSignal
  const waiting=session.waitForDisconnect(async signal=>{promptSignal=signal;started.resolve();await button.promise}).then(()=>{completed=true})
  await started.promise;assert.equal(completed,false);assert.equal(session.launcherStatus(),'unconfirmed')
  button.resolve();await waiting;assert.equal(promptSignal.aborted,true);assert.ok(f.calls.includes('unref'))
  assert.equal(session.launcherStatus(),'unconfirmed');await access(f.files.launched)
})

test('credential exists only in mocked child environment; persisted files and arguments are token-free',async t=>{
  const f=await fixture(t),session=await f.begin(),call=f.calls.find(c=>typeof c==='object')
  assert.equal(call.env[setup.envVar],TOKEN);assert.equal(call.env.GH_TOKEN,undefined)
  assert.equal(call.options.env[setup.envVar],undefined);assert.equal(f.options.credential,undefined)
  assert.equal(call.env.COPILOT_HOME,f.files.copilot);assert.equal(call.env.TEMP,f.files.temp)
  assert.equal(call.args.includes(f.files.mcp),false);assert.equal(JSON.stringify(call.args).includes(TOKEN),false)
  assert.equal(call.options.cwd,f.files.root)
  for(const file of [f.files.mcp,f.files.settings,f.files.owner,f.files.launched])assert.equal((await readFile(file,'utf8')).includes(TOKEN),false)
  await session.waitForDisconnect(async()=>{})
})

test('token-free lifecycle launches only an owned empty MCP config, no hosted endpoint or credential',async t=>{
  const f=await fixture(t,'token-free'),session=await f.begin(),call=f.calls.find(c=>typeof c==='object')
  assert.equal(call.env[setup.envVar],undefined)
  assert.deepEqual(JSON.parse(await readFile(f.files.mcp,'utf8')),{mcpServers:{}})
  assert.equal((await readFile(f.files.mcp,'utf8')).includes(setup.endpoint),false)
  await session.waitForDisconnect(async()=>{});await removeCopilotSession(f.home,setup,f.hash,'token-free')
  await assert.rejects(access(f.files.mcp));await access(f.files.settings)
})

for(const stage of ['before','during'])test('controller interruption triggers cleanup without a process kill: '+stage,async t=>{
  const f=await fixture(t),stop=new AbortController()
  if(stage==='before'){
    stop.abort();await assert.rejects(startCopilotSession(f.exe,f.home,setup,{...f.options,signal:stop.signal}),e=>e.code==='interrupted')
    assert.equal(f.calls.length,0);return
  }
  const session=await f.begin(),ready=deferred();let promptSignal
  const waiting=session.waitForDisconnect(signal=>{promptSignal=signal;ready.resolve();return new Promise(()=>{})},stop.signal)
  await ready.promise;stop.abort();await assert.rejects(waiting,e=>e.code==='interrupted')
  assert.equal(promptSignal.aborted,true)
  await f.store.save(f.record)
  const result=await cleanup(f.store,f.adapter,f.record,f.owner)
  assert.equal(result.revoked,true);assert.equal(result.removed,true);assert.equal(session.launcherStatus(),'unconfirmed')
  assert.ok(f.messages.some(m=>m.includes('termination: UNVERIFIED')))
})

for(const event of ['normal-exit','bad-exit','error'])test('launcher observation never claims agent termination: '+event,async t=>{
  const f=await fixture(t),session=await f.begin(),ready=deferred()
  const waiting=session.waitForDisconnect(()=>{ready.resolve();return new Promise(()=>{})})
  await ready.promise
  if(event==='error')f.child.emit('error',new Error(TOKEN))
  else f.child.emit('exit',event==='normal-exit'?0:1)
  if(event==='normal-exit')await waiting
  else await assert.rejects(waiting,e=>e.code===(event==='error'?'client_launch_failed':'client_exit_failed')&&!e.message.includes(TOKEN))
  assert.equal(session.launcherStatus(),event==='error'?'unconfirmed':'exit-observed')
  assert.ok(f.calls.includes('unref'))
})

test('single-use receipt blocks a second launch even after configuration was removed',async t=>{
  const f=await fixture(t),session=await f.begin();await session.waitForDisconnect(async()=>{})
  await assert.rejects(f.begin());assert.equal(f.calls.filter(c=>typeof c==='object').length,1)
  await f.adapter.remove(setup,f.hash);await assert.rejects(f.adapter.install(setup))
})
for(const conflict of ['settings','legacy-marker','extension'])test('unsafe launch fails before spawning: '+conflict,async t=>{
  const f=await fixture(t)
  if(conflict==='settings')await writeFile(f.files.settings,'{}')
  if(conflict==='legacy-marker')await writeFile(f.files.process,'{"legacy":true}')
  if(conflict==='extension')await writeFile(path.join(f.files.extensions,'unexpected'),'keep')
  await assert.rejects(f.begin(),e=>e.code==='configuration_changed')
  assert.equal(f.calls.length,0);await access(f.files.mcp)
})
test('synchronous launch failure keeps the single-use receipt and clears the credential',async t=>{
  const f=await fixture(t);f.runtime.spawn=()=>{throw new Error(TOKEN)}
  await assert.rejects(f.begin(),e=>e.code==='client_launch_failed'&&!e.message.includes(TOKEN))
  assert.equal(f.options.credential,undefined);await access(f.files.launched)
})

test('Disconnect independently verifies server revocation before owned config removal',async t=>{
  const f=await fixture(t);await f.store.save(f.record)
  await disconnect(f.store,f.adapter,ui,async action=>action(f.owner),PROJECT)
  const revoke=f.apiCalls.findIndex(c=>c.route.endsWith('/revoke_mcp_connection'))
  assert.ok(revoke>=0);assert.ok(f.apiCalls.slice(revoke+1).some(c=>c.route.startsWith('/rest/v1/mcp_connections')))
  assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.files.mcp))
  assert.ok(f.messages.some(m=>m.includes('File > Exit')&&m.includes('UNVERIFIED')))
})
for(const failure of ['rpc','verification','no-owner'])test('uncertain revocation preserves pending evidence: '+failure,async t=>{
  const f=await fixture(t);await f.store.save(f.record)
  const original=f.owner.api
  let afterRevoke=false
  f.owner.api=async(...args)=>{
    if(args[0].endsWith('/revoke_mcp_connection')){afterRevoke=true;if(failure==='rpc')throw new ConnectorError('request_failed')}
    if(afterRevoke&&failure==='verification'&&args[0].startsWith('/rest/v1/mcp_connections'))throw new ConnectorError('request_failed')
    return original(...args)
  }
  const result=await cleanup(f.store,f.adapter,f.record,failure==='no-owner'?undefined:f.owner)
  assert.equal(result.revoked,false);assert.equal(result.removed,true)
  const [saved]=await f.store.read();assert.equal(saved.phase,'revocation_pending');assert.equal(saved.connectionId,CONNECTION)
  assert.equal(JSON.stringify(saved).includes(TOKEN),false)
  assert.ok(result.unresolved.includes('revocation_unconfirmed'))
})

test('confirmed revocation is independent of unexpected local configuration edits',async t=>{
  const f=await fixture(t);await f.store.save(f.record)
  const changed='{"mcpServers":{"unrelated":{"type":"http","url":"http://example.invalid"}}}'
  await writeFile(f.files.mcp,changed)
  const result=await cleanup(f.store,f.adapter,f.record,f.owner)
  assert.equal(result.revoked,true);assert.equal(result.removed,false)
  assert.equal((await f.store.read())[0].phase,'revoked');assert.equal(await readFile(f.files.mcp,'utf8'),changed)
})

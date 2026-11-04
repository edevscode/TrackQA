import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { readFile, writeFile, rm, access, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseSyntheticArgs } from './copilot-synthetic.mjs'
import { createCopilotSyntheticFixture, loopbackEndpoint, syntheticConfiguration, validateSyntheticConfiguration, verifySyntheticRejection } from '../src/testing/copilot-synthetic.ts'
import { copilotPaths, copilotPayloads, readCopilotSession } from '../src/clients/vscode-copilot-session.ts'
import { copilotLaunchArgs, vscodeCopilotAdapter } from '../src/clients/vscode-copilot.ts'
import { setupFor, SUPABASE_URL, TOKEN } from '../src/core.ts'
import { connect } from '../src/workflow.ts'
const ui={say(){},confirm:async()=>true,choose:async()=>0}
const envVar='TRACKQA_SYNTHETIC_'+'A'.repeat(32),name='trackqaSynthetic_'+'a'.repeat(32)
async function fixture(t) {
  const f=await createCopilotSyntheticFixture({mode:'loopback-synthetic'})
  t.after(async()=>{await f.close();assert.equal(path.dirname(f.root),path.resolve(os.tmpdir()));assert.ok(path.basename(f.root).startsWith('trackqa-copilot-synthetic-'));await rm(f.root,{recursive:true,force:true})})
  const child=new EventEmitter(),calls=[]
  child.unref=()=>{calls.push('unref')};child.kill=()=>assert.fail('No process termination')
  const exe={path:path.join(f.root,'Code.exe'),installation:f.root,sha256:'a'.repeat(64),version:'1.143.1',inputs:[],appServer:false,foregroundMode:'direct'}
  const runtime={verify:async value=>{assert.equal(value,exe)},spawn:(command,args,options)=>{calls.push({command,args,env:{...options.env},options});return child}}
  return Object.assign(f,{child,calls,exe,runtime})
}
async function launch(f) {return f.launch(f.exe,{runtime:f.runtime,source:{PATH:'safe',GH_TOKEN:'must-not-inherit'}})}
async function post(f,credential,method,params={}) {
  const response=await fetch(f.endpoint,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  const text=await response.text();return{status:response.status,value:text?JSON.parse(text):null}
}

test('only an explicit synthetic mode selects the manual test entry; production arguments do not',()=>{
  assert.deepEqual(parseSyntheticArgs(['--synthetic-loopback']),{mode:'loopback-synthetic',executable:undefined})
  for(const args of [[],['connect'],['--synthetic-loopback','--endpoint','https://example.invalid'],['--synthetic-loopback','--token','secret'],['--synthetic-loopback','--vscode-path','relative']])assert.throws(()=>parseSyntheticArgs(args))
})
test('fixture refuses missing or unknown modes and non-loopback bind hosts before creating state',async()=>{
  for(const options of [{},{mode:'session'},{mode:'loopback-synthetic',host:'0.0.0.0'},{mode:'loopback-synthetic',host:'localhost'}])await assert.rejects(createCopilotSyntheticFixture(options))
})
for(const endpoint of ['https://127.0.0.1:1234/mcp','http://localhost:1234/mcp','http://0.0.0.0:1234/mcp','http://127.1:1234/mcp','http://2130706433:1234/mcp','http://[::ffff:127.0.0.1]:1234/mcp','http://127.0.0.1:65536/mcp','http://127.0.0.1:1234/mcp?next=https://example.invalid','http://user:pass@127.0.0.1:1234/mcp',SUPABASE_URL+'/functions/v1/trackqa-mcp'])test('strict synthetic endpoint refuses '+endpoint.split('?')[0],()=>{assert.throws(()=>loopbackEndpoint(endpoint))})
test('literal IPv4 and IPv6 loopback with explicit ports are accepted',()=>{
  for(const endpoint of ['http://127.0.0.1:1234/mcp','http://[::1]:1234/mcp'])assert.equal(loopbackEndpoint(endpoint).href,endpoint)
})
test('synthetic configuration rejects plaintext credentials, extra entries and malformed header references',()=>{
  const endpoint='http://127.0.0.1:1234/mcp',valid=syntheticConfiguration(endpoint,envVar,name)
  validateSyntheticConfiguration(valid,endpoint,envVar,name)
  for(const header of ['Bearer synthetic-not-for-storage','Bearer ${env:OTHER}','Bearer ${OTHER}']){
    const bad=structuredClone(valid);bad.mcpServers[name].headers.Authorization=header
    assert.throws(()=>validateSyntheticConfiguration(bad,endpoint,envVar,name))
  }
  const extra=structuredClone(valid);extra.mcpServers.other={type:'http',url:endpoint}
  assert.throws(()=>validateSyntheticConfiguration(extra,endpoint,envVar,name))
  assert.throws(()=>syntheticConfiguration(endpoint,'OTHER',name))
})
test('production validator still refuses synthetic endpoints and synthetic ownership markers',async t=>{
  const f=await fixture(t),projectId=path.basename(f.files.root),canonical=setupFor(projectId,'vscode-copilot')
  assert.throws(()=>copilotPaths(f.home,{...canonical,endpoint:f.endpoint}))
  await assert.rejects(readCopilotSession(f.home,canonical),e=>e.code==='configuration_conflict')
  const adapter=vscodeCopilotAdapter(f.exe,f.home)
  await assert.rejects(adapter.prepare(),e=>e.code==='copilot_runtime_unverified')
  const forbidden=new Proxy({},{get(){assert.fail('No authentication or hosted access')}})
  await assert.rejects(connect({adapter,store:forbidden,owner:forbidden,ui:forbidden}),e=>e.code==='copilot_runtime_unverified')
})
test('shared launch uses isolated empty-window arguments and child-only random synthetic credentials',async t=>{
  const f=await fixture(t),session=await launch(f),call=f.calls.find(c=>typeof c==='object')
  const canonical=setupFor(path.basename(f.files.root),'vscode-copilot')
  assert.deepEqual(call.args,copilotLaunchArgs(f.home,canonical));assert.equal(call.options.cwd,f.files.root)
  assert.equal(call.env.COPILOT_HOME,f.files.copilot);assert.equal(call.env.GH_TOKEN,undefined)
  const credential=call.env[f.envVar];assert.match(credential,/^synthetic_[a-f0-9]{64}$/);assert.equal(TOKEN.test(credential),false)
  assert.equal(call.options.env[f.envVar],undefined);assert.equal(JSON.stringify(call.args).includes(credential),false)
  const config=JSON.parse(await readFile(f.files.mcp,'utf8'))
  assert.deepEqual(Object.keys(config.mcpServers),[f.name]);assert.equal(config.mcpServers[f.name].headers.Authorization,'Bearer ${'+f.envVar+'}')
  for(const file of [f.files.mcp,f.files.settings,f.files.owner,f.files.launched,path.join(f.store.root,'connections.json')]){
    const text=await readFile(file,'utf8');assert.equal(text.includes(credential),false);assert.equal(text.includes(SUPABASE_URL),false)
  }
  await session.waitForDisconnect(async()=>{});await f.disconnect(ui)
})
test('loopback MCP initializes, discovers one tool, permits one call, then rejects the credential after real Disconnect',async t=>{
  const f=await fixture(t),session=await launch(f),credential=f.calls.find(c=>typeof c==='object').env[f.envVar]
  assert.equal((await post(f,credential,'initialize',{protocolVersion:'2025-11-25'})).status,200)
  const list=await post(f,credential,'tools/list');assert.deepEqual(list.value.result.tools.map(t=>t.name),['synthetic_status'])
  const call=await post(f,credential,'tools/call',{name:'synthetic_status',arguments:{}})
  assert.equal(call.value.result.content[0].text,'TRACKQA_SYNTHETIC_OK')
  assert.equal((await post(f,credential,'tools/call',{name:'synthetic_status',arguments:{}})).status,400)
  assert.equal((await post(f,'incorrect','tools/list')).status,401)
  const clientHeaders=f.status().matchingHeaders
  await session.waitForDisconnect(async()=>{});await f.disconnect(ui)
  assert.equal(f.status().rejectionVerified,true);assert.equal((await post(f,credential,'tools/list')).status,401)
  assert.equal(f.status().matchingHeaders,clientHeaders)
  assert.equal(f.status().toolCalls,1);assert.deepEqual(await f.store.read(),[])
  await assert.rejects(access(f.files.mcp));await access(f.files.settings);assert.equal(session.launcherStatus(),'unconfirmed')
  await f.close();assert.equal(f.status().listenerActive,false)
})
test('independent revocation verification refuses redirects without contacting their destination',async t=>{
  const server=createServer((_req,res)=>{res.writeHead(302,{Location:'http://non-loopback.invalid/never'});res.end()})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  await assert.rejects(verifySyntheticRejection('http://127.0.0.1:'+server.address().port+'/mcp','synthetic-test-only'),e=>e.code==='synthetic_revocation_unconfirmed')
})
test('unavailable rejection check retains revocation_pending recovery and blocks another launch',async t=>{
  const f=await fixture(t);await f.close()
  await assert.rejects(f.disconnect(ui),e=>e.code==='cleanup_unconfirmed')
  assert.equal((await f.store.read())[0].phase,'revocation_pending');assert.equal(f.status().rejectionVerified,false)
  await assert.rejects(launch(f));await assert.rejects(access(f.files.mcp))
})
for(const change of ['owner','mcp','local-duplicate'])test('unexpected configuration is preserved: '+change,async t=>{
  const f=await fixture(t)
  const file=change==='owner'?f.files.owner:change==='mcp'?f.files.mcp:f.files.localMcp
  await writeFile(file,'{"unrelated":"${KEEP_LITERAL}"}')
  await assert.rejects(launch(f));await assert.rejects(f.disconnect(ui))
  assert.equal(await readFile(file,'utf8'),'{"unrelated":"${KEEP_LITERAL}"}')
  assert.equal(f.status().rejectionVerified,true);assert.equal((await f.store.read())[0].phase,'revoked')
})
test('interrupting the controller invokes shared cleanup without process termination or runtime-data deletion',async t=>{
  const f=await fixture(t),session=await launch(f),stop=new AbortController()
  const waiting=session.waitForDisconnect(()=>new Promise(()=>{}),stop.signal)
  stop.abort();await assert.rejects(waiting,e=>e.code==='interrupted')
  const keep=path.join(f.files.shared,'keep');await mkdir(keep);await writeFile(path.join(keep,'data'),'preserve')
  await f.disconnect(ui)
  assert.equal(f.status().rejectionVerified,true);assert.equal(await readFile(path.join(keep,'data'),'utf8'),'preserve')
  assert.equal(session.launcherStatus(),'unconfirmed');assert.ok(f.calls.includes('unref'))
})
test('fresh synthetic fixtures never reuse each other or normal profiles',async t=>{
  const a=await fixture(t),b=await fixture(t)
  assert.notEqual(a.root,b.root);assert.notEqual(a.envVar,b.envVar);assert.notEqual(a.name,b.name)
  assert.deepEqual(JSON.parse(copilotPayloads(setupFor(path.basename(a.files.root),'vscode-copilot'),'token-free').mcp),{mcpServers:{}})
  await a.disconnect(ui);await access(b.files.mcp);await b.disconnect(ui)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access, rm, rmdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs, setupFor, ConnectorError } from '../src/core.ts'
import { Store, validateRecord, recordHome } from '../src/state.ts'
import { connect, cleanup, disconnect } from '../src/workflow.ts'
import { safeCode, locations, main } from '../src/cli.ts'
import { copilotEnvironment, copilotLaunchArgs, vscodeCopilotAdapter } from '../src/clients/vscode-copilot.ts'
import { copilotPaths, copilotPayloads, copilotEntry, freshCopilotHome, copilotRecoveryHome, installCopilotSession, removeCopilotSession } from '../src/clients/vscode-copilot-session.ts'

const PROJECT='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222',CONNECTION='33333333-3333-4333-8333-333333333333'
const setup=setupFor(PROJECT,'vscode-copilot'),TOKEN='tqm_'+'a'.repeat(64)
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-copilot-offline-'))
  t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('trackqa-copilot-offline-'));await rm(root,{recursive:true,force:true})})
  const home=path.join(root,'profiles'),exe={path:path.join(root,'Code.exe'),sha256:'a'.repeat(64),version:'1.143.1',appServer:false,foregroundMode:'direct',inputs:[],installation:root}
  const adapter=vscodeCopilotAdapter(exe,home),files=copilotPaths(home,setup),store=new Store(path.join(root,'journal'))
  const record={projectId:PROJECT,userId:USER,client:'vscode-copilot',vscodeCopilotHome:home,executable:exe.path,
    clientLabel:'TrackQA Connect 44444444-4444-4444-8444-444444444444',connectionId:null,phase:'planned',installed:false,lastVerifiedAt:null,configHash:null}
  return {root,home,exe,adapter,files,store,record}
}
test('explicit Copilot identity accepts only its VS Code path option and isolates identifiers',()=>{
  assert.deepEqual(parseArgs(['connect','--client','vscode-copilot','--vscode-path','C:\\safe\\Code.exe']),{command:'connect',client:'vscode-copilot',executable:'C:\\safe\\Code.exe'})
  for(const command of ['status','disconnect'])assert.equal(parseArgs([command,'--client','vscode-copilot']).client,'vscode-copilot')
  for(const args of [['connect','--client','vscode-copilot','--claude-only'],['connect','--client','vscode-copilot','--codex-path','x'],['connect','--client','vscode-copilot','--token','secret']])assert.throws(()=>parseArgs(args))
  const clients=['codex','gemini','claude','vscode','vscode-copilot']
  for(const field of ['envVar','serverName'])assert.equal(new Set(clients.map(c=>setupFor(PROJECT,c)[field])).size,5)
  assert.match(setup.envVar,/^[A-Z_][A-Z0-9_]*$/);assert.ok(setup.envVar.endsWith('_VSCODE_COPILOT'))
})
test('dedicated CLI location never overlaps the existing Local session directory',async()=>{
  const paths=await locations(process.env,'vscode-copilot')
  assert.notEqual(paths.vscodeHome,paths.vscodeCopilotHome)
  assert.equal(path.basename(paths.vscodeCopilotHome),'vscode-copilot-sessions')
})
test('portable config is the only registration source and cleanup preserves unrelated files',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),text=await readFile(f.files.mcp,'utf8')
  assert.equal(f.files.mcp,path.join(f.files.copilot,'mcp-config.json'))
  assert.deepEqual(JSON.parse(text),{mcpServers:{[setup.serverName]:{type:'http',url:setup.endpoint,headers:{Authorization:'Bearer ${'+setup.envVar+'}'}}}})
  assert.equal(text.includes('${env:'),false);assert.equal(text.includes(TOKEN),false)
  await assert.rejects(access(f.files.localMcp));assert.deepEqual(await f.adapter.entry(setup),copilotEntry(setup))
  const normal=path.join(f.root,'normal.json'),unexpected=path.join(f.files.shared,'keep.txt')
  await writeFile(normal,'{"other":"${KEEP_LITERAL}"}');await writeFile(unexpected,'keep')
  await f.adapter.remove(setup,hash)
  await assert.rejects(access(f.files.mcp));await access(f.files.settings)
  assert.equal(await readFile(normal,'utf8'),'{"other":"${KEEP_LITERAL}"}');assert.equal(await readFile(unexpected,'utf8'),'keep')
  await access(f.files.owner);await assert.rejects(f.adapter.install(setup))
})
test('paths, environment and empty-window arguments isolate Copilot and shared storage',async t=>{
  const f=await fixture(t),args=copilotLaunchArgs(f.home,setup),source={PATH:'safe',HOME:'normal',USERPROFILE:'normal',COPILOT_HOME:'normal',
    HTTP_PROXY:'https://synthetic:private@example.invalid',NODE_USE_SYSTEM_CA:'1',VSCODE_IPC_HOOK_CLI:'normal',
    NODE_TLS_REJECT_UNAUTHORIZED:'0',NODE_OPTIONS:'unsafe',GH_TOKEN:'synthetic-account-secret',[setup.envVar]:TOKEN}
  const env=copilotEnvironment(f.home,setup,source)
  assert.equal(env.COPILOT_HOME,f.files.copilot);assert.equal(env.HOME,f.files.home);assert.equal(env.USERPROFILE,f.files.home)
  assert.equal(env.TEMP,f.files.temp);assert.equal(env.TMP,f.files.temp);assert.equal(env.HTTP_PROXY,source.HTTP_PROXY)
  assert.equal(env.NODE_USE_SYSTEM_CA,'1')
  for(const key of ['GH_TOKEN',setup.envVar,'VSCODE_IPC_HOOK_CLI','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED'])assert.equal(env[key],undefined)
  assert.equal(source[setup.envVar],TOKEN)
  const values=new Map([['--user-data-dir',f.files.user],['--extensions-dir',f.files.extensions],['--shared-data-dir',f.files.shared],['--sync','off'],['--log','warning']])
  const flags=new Set(['--new-window','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--use-inmemory-secretstorage'])
  for(let i=0;i<args.length;i++){assert.ok(flags.has(args[i])||values.has(args[i]));if(values.has(args[i]))assert.equal(args[i+1],values.get(args[i++]));}
  assert.ok(args.includes('--use-inmemory-secretstorage'));assert.equal(args.includes('--disable-workspace-trust'),false)
  assert.equal(JSON.stringify(args).includes(TOKEN),false)
})
test('path validation rejects Local setup, changed identifiers, endpoints and escape paths',async t=>{
  const f=await fixture(t)
  for(const value of [setupFor(PROJECT,'vscode'),{...setup,projectId:'../escape'},{...setup,endpoint:'http://example.invalid'},{...setup,envVar:'OTHER'}])assert.throws(()=>copilotPaths(f.home,value))
  assert.throws(()=>copilotPaths('relative',setup))
})
for(const kind of ['foreign-folder','extra-server','local-duplicate','wrong-hash'])test('configuration conflicts fail closed and preserve files: '+kind,async t=>{
  const f=await fixture(t)
  if(kind==='foreign-folder'){
    await mkdir(f.files.root,{recursive:true});await writeFile(path.join(f.files.root,'keep'),'keep')
    await assert.rejects(f.adapter.install(setup),e=>e.code==='configuration_conflict');return
  }
  const hash=await f.adapter.install(setup)
  if(kind==='extra-server')await writeFile(f.files.mcp,JSON.stringify({mcpServers:{...JSON.parse(await readFile(f.files.mcp,'utf8')).mcpServers,other:{type:'http',url:'http://example.invalid'}}}))
  if(kind==='local-duplicate')await writeFile(f.files.localMcp,'{"servers":{}}')
  const before=await readFile(f.files.mcp)
  await assert.rejects(f.adapter.remove(setup,kind==='wrong-hash'?'0'.repeat(64):hash))
  assert.deepEqual(await readFile(f.files.mcp),before)
})
test('symlinked shared storage is rejected without following or removing its target',async t=>{
  const f=await fixture(t);await f.adapter.install(setup)
  const target=path.join(f.root,'unrelated');await mkdir(target);await writeFile(path.join(target,'keep'),'keep')
  await rmdir(f.files.shared);await symlink(target,f.files.shared,'junction')
  await assert.rejects(f.adapter.remove(setup,null),e=>e.code==='configuration_location_untrusted')
  assert.equal(await readFile(path.join(target,'keep'),'utf8'),'keep');await access(f.files.mcp)
})
test('runtime guard blocks CLI and direct workflow before authentication, prompts, hosted calls or launch',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.adapter.prepare(),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(f.adapter.verify(setup,TOKEN),e=>e.code==='copilot_runtime_unverified')
  const forbidden=new Proxy({},{get(){assert.fail('No Owner, Store or UI interaction is permitted')}})
  await assert.rejects(connect({adapter:f.adapter,owner:forbidden,store:forbidden,ui:forbidden}),e=>e.code==='copilot_runtime_unverified')
  assert.equal(safeCode(new ConnectorError('copilot_runtime_unverified')),'copilot_runtime_unverified')
  assert.equal(safeCode(new Error(TOKEN)),'operation_failed')
  // Verify the real CLI preparation boundary with static detection only; no spawn.
  const cli=await readFile(new URL('../src/cli.ts',import.meta.url),'utf8')
  assert.ok(cli.indexOf('await adapter.prepare?.()')<cli.indexOf('const authenticate ='))
  assert.equal(typeof main,'function')
  await assert.rejects(access(f.files.root))
})
test('all existing recovery schemas survive and Copilot records remain separate',async t=>{
  const f=await fixture(t),others=['codex','gemini','claude','vscode'].map(client=>{
    const r={...f.record,client};delete r.vscodeCopilotHome;r[client+'Home']=path.join(f.root,client);return r
  })
  for(const record of [...others,f.record]){validateRecord(record);await f.store.save(record)}
  assert.equal((await f.store.read()).length,5);assert.equal(recordHome(f.record),f.home)
  await f.store.remove(PROJECT,'vscode-copilot');assert.deepEqual(await f.store.read(),others)
  for(const bad of [{...f.record,vscodeHome:f.home},{...f.record,vscodeCopilotHome:undefined},{...f.record,accessToken:TOKEN}])assert.throws(()=>validateRecord(bad))
})
for(const failure of ['none','local-process','revocation'])test('existing cleanup revokes the correct connection and retains unresolved recovery: '+failure,async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),record={...f.record,connectionId:CONNECTION,phase:'active',installed:true,configHash:hash}
  const other={...f.record,client:'vscode',vscodeHome:path.join(f.root,'local')};delete other.vscodeCopilotHome;await f.store.save(other);await f.store.save(record)
  if(failure==='local-process')await writeFile(f.files.process,'{"legacy":true}')
  let revoked=false
  const owner={userId:USER,api:async(route,method='GET',body)=>{
    if(route.startsWith('/rest/v1/project_members'))return[{user_id:USER,role:'OWNER'}]
    if(route.startsWith('/rest/v1/projects'))return[{id:PROJECT,name:'Synthetic',key:'SYNTH',archived:false,mcp_enabled:true}]
    if(route.startsWith('/rest/v1/mcp_connections'))return[{id:CONNECTION,project_id:PROJECT,user_id:USER,client_label:record.clientLabel,revoked_at:revoked?'synthetic':null}]
    if(route.endsWith('/revoke_mcp_connection')){assert.equal(method,'POST');assert.deepEqual(body,{p_connection_id:CONNECTION});if(failure==='revocation')throw new ConnectorError('request_failed');revoked=true;return null}
    assert.fail('Unexpected route or application write')
  }}
  const result=await cleanup(f.store,f.adapter,record,owner),records=await f.store.read()
  assert.equal(result.revoked,failure!=='revocation');assert.equal(result.removed,failure!=='local-process')
  assert.deepEqual(records.find(r=>r.client==='vscode'),other)
  if(failure==='none')assert.equal(records.length,1)
  else {assert.equal(records.length,2);assert.ok(result.unresolved.length);assert.equal(records.find(r=>r.client==='vscode-copilot').phase,failure==='revocation'?'revocation_pending':'revoked')}
})
test('local-only disconnect reuses the shared recovery workflow without Owner authentication',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup);await f.store.save({...f.record,phase:'installed',installed:true,configHash:hash})
  await disconnect(f.store,f.adapter,{say(){},confirm:async()=>true,choose:async()=>0},async()=>assert.fail('No authentication needed'),PROJECT)
  assert.deepEqual(await f.store.read(),[]);await assert.rejects(access(f.files.mcp))
})

test('fresh homes are single-session and recorded recovery homes cannot escape',async t=>{
  const f=await fixture(t),a=freshCopilotHome(f.home),b=freshCopilotHome(f.home)
  assert.notEqual(a,b);assert.equal(copilotRecoveryHome(f.home,a),a)
  assert.equal(copilotRecoveryHome(f.home,f.home),f.home)
  for(const bad of [path.dirname(f.home),path.join(f.home,'runs','invalid'),a+path.sep+'extra',path.join(f.home,'other')])assert.throws(()=>copilotRecoveryHome(f.home,bad))
})
test('removal preserves edited settings, launch receipt, runtime data and unrelated references',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  await writeFile(f.files.settings,'{"unrelated":"$'+'{KEEP_LITERAL}"}')
  await writeFile(f.files.launched,'{"owner":"receipt"}')
  const before=await readFile(f.files.settings)
  await f.adapter.remove(setup,hash)
  assert.deepEqual(await readFile(f.files.settings),before);await access(f.files.launched)
  await assert.rejects(f.adapter.install(setup));await assert.rejects(access(f.files.mcp))
})
test('legacy owner marker is not adopted or deleted',async t=>{
  const f=await fixture(t);await f.adapter.install(setup)
  const old=JSON.stringify({owner:'TrackQA Connect VS Code Copilot foundation v1',client:'vscode-copilot',projectId:PROJECT,server:setup.serverName})
  await writeFile(f.files.owner,old)
  await assert.rejects(f.adapter.remove(setup,null),e=>e.code==='configuration_conflict')
  assert.equal(await readFile(f.files.owner,'utf8'),old);await access(f.files.mcp)
})
test('token-free preparation stays empty without a hosted template and refuses conversion',async t=>{
  const f=await fixture(t),hash=await installCopilotSession(f.home,setup,'token-free')
  assert.deepEqual(JSON.parse(await readFile(f.files.mcp,'utf8')),{mcpServers:{}})
  assert.equal((await readFile(f.files.mcp,'utf8')).includes(setup.endpoint),false)
  await assert.rejects(f.adapter.install(setup));await assert.rejects(f.adapter.remove(setup,null))
  await removeCopilotSession(f.home,setup,hash,'token-free');await assert.rejects(access(f.files.mcp))
})
test('owned configuration and recovery artifacts never store the synthetic credential',async t=>{
  const f=await fixture(t);await f.adapter.install(setup);await f.store.save(f.record)
  for(const file of [f.files.owner,f.files.mcp,f.files.settings,path.join(f.store.root,'connections.json')]){
    const text=await readFile(file,'utf8');assert.equal(text.includes(TOKEN),false);assert.doesNotMatch(text,/tqm_[a-f0-9]{64}|synthetic-account-secret|synthetic:private/)
  }
  assert.equal(JSON.stringify(copilotPayloads(setup)).includes(TOKEN),false)
})

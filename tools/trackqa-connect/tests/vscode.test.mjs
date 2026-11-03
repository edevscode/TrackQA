import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { trustedVSCodeLocation, checkVSCodeExecutable, detectVSCode, vscodeAdapter, vscodeEnvironment, vscodeLaunchArgs, vscodeVerification, vscodeInstructions } from '../src/clients/vscode.ts'
import { vscodePaths, vscodePayloads, vscodeEntry, readVSCodeSession, writeVSCodeFile } from '../src/clients/vscode-session.ts'
import { settleVSCodeRun } from '../src/clients/vscode-process.ts'
import { parseArgs, setupFor, tools, ConnectorError } from '../src/core.ts'
import { Store, validateRecord } from '../src/state.ts'
import { connect, disconnect } from '../src/workflow.ts'
import { safeCode } from '../src/cli.ts'

const PROJECT='11111111-1111-4111-8111-111111111111',USER='22222222-2222-4222-8222-222222222222',CONNECTION='33333333-3333-4333-8333-333333333333'
const TOKEN='tqm_'+'a'.repeat(64),setup=setupFor(PROJECT,'vscode')
async function fixture(t, options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-vscode-unit-'))
  t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('trackqa-vscode-unit-'));await rm(root,{recursive:true,force:true})})
  const bin=path.join(root,'installation','Code.exe'),app=path.join(path.dirname(bin),'abcdef0123','resources','app')
  for(const dir of [path.join(path.dirname(bin),'bin'),path.join(app,'out')])await mkdir(dir,{recursive:true})
  await writeFile(bin,'synthetic native executable - never executed')
  await writeFile(path.join(path.dirname(bin),'bin','code.cmd'),'"%~dp0..\\Code.exe" "%~dp0..\\abcdef0123\\resources\\app\\out\\cli.js" %*')
  await writeFile(path.join(app,'product.json'),JSON.stringify({applicationName:'code',quality:'stable',version:'1.143.1'}))
  await writeFile(path.join(app,'package.json'),JSON.stringify({version:'1.143.1'}))
  await writeFile(path.join(app,'out','cli.js'),'user-data-dir extensions-dir use-inmemory-secretstorage disable-updates')
  const exe=await checkVSCodeExecutable(bin,()=>true),home=path.join(root,'profiles')
  const baseline=[{pid:10,created:'baseline',owned:false}]
  let rows=[...baseline],child,spawned=0,closed=0,snapshot,heldEnv
  const runtime={graceMs:20,
    async snapshot(){if(options.probeFails)throw new ConnectorError('vscode_process_unconfirmed');return [...rows]},
    async close(_user,row){closed++;assert.equal(row.pid,100);rows=[...baseline];queueMicrotask(()=>child.emit('exit',0))},
    spawn(file,args,opts){
      spawned++;snapshot={file,args,env:{...opts.env},options:opts};heldEnv=opts.env
      child=new EventEmitter();child.pid=100;child.kill=()=>assert.fail('Must never kill a process')
      rows=[...baseline,{pid:100,created:'new',owned:true}]
      setTimeout(()=>{
        if(options.abort){options.abort.abort();return}
        rows=options.leftover?[...baseline,{pid:101,created:'descendant',owned:false}]:[...baseline]
        child.emit(options.spawnError?'error':'exit',options.spawnError?Error('synthetic private detail'):0)
      },30)
      return child
    },
  }
  const source={PATH:'safe',USERPROFILE:'normal-user',HOME:'normal-home',APPDATA:'normal-appdata',LOCALAPPDATA:'normal-local',HTTPS_PROXY:'https://synthetic:private@example.invalid',
    VSCODE_IPC_HOOK_CLI:'existing-instance',NODE_OPTIONS:'unsafe',NODE_TLS_REJECT_UNAUTHORIZED:'0',OPENAI_API_KEY:'private-provider',SUPABASE_DB_PASSWORD:'private-database',[setup.envVar]:TOKEN}
  const adapter=vscodeAdapter(exe,home,source,runtime),files=vscodePaths(home,setup)
  return {root,bin,app,exe,home,adapter,files,runtime,source,baseline,get snapshot(){return snapshot},get heldEnv(){return heldEnv},get spawned(){return spawned},get closed(){return closed},set rows(value){rows=value}}
}
test('VS Code client and path flags are explicit and names are distinct across all adapters',()=>{
  assert.deepEqual(parseArgs(['connect','--client','vscode','--vscode-path','C:\\safe\\Code.exe']),{command:'connect',client:'vscode',executable:'C:\\safe\\Code.exe'})
  for(const args of [['connect','--vscode-path','x'],['connect','--client','codex','--vscode-path','x'],['connect','--client','vscode','--claude-only'],['connect','--client','vscode','--codex-path','x']])assert.throws(()=>parseArgs(args))
  for(const field of ['envVar','serverName'])assert.equal(new Set(['codex','gemini','claude','vscode'].map(c=>setupFor(PROJECT,c)[field])).size,4)
})
test('detection accepts only exact supported Windows VS Code locations, never shims, forks or repo executables',()=>{
  const home='C:\\Users\\owner',cwd='C:\\work\\trackqa',check=p=>trustedVSCodeLocation(p,home,'win32',cwd)
  assert.ok(check(home+'\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'));assert.ok(check('C:\\Program Files\\Microsoft VS Code\\Code.exe'))
  for(const p of ['code',cwd+'\\Code.exe',home+'\\Downloads\\Code.exe',home+'\\AppData\\Local\\Programs\\Antigravity\\Code.exe','C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd'])assert.equal(check(p),false)
  assert.equal(trustedVSCodeLocation('/usr/bin/code',home,'linux',cwd),false)
})
test('static detection verifies version and CLI flags without running VS Code or accessing a normal profile',async t=>{
  const f=await fixture(t),calls=[]
  const exe=await detectVSCode(f.bin,{},async p=>{calls.push(p);return checkVSCodeExecutable(p,()=>true)})
  assert.equal(exe.version,'1.143.1');assert.equal(exe.inputs.length,5);assert.deepEqual(calls,[f.bin])
  await assert.rejects(detectVSCode(undefined,{},async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'})}),e=>e.code==='client_not_found')
  await assert.rejects(checkVSCodeExecutable('code'),e=>e.code==='executable_untrusted')
})
for(const kind of ['version','fork','portable','flags'])test('unsupported native layout fails closed: '+kind,async t=>{
  const f=await fixture(t)
  if(kind==='version')await writeFile(path.join(f.app,'package.json'),JSON.stringify({version:'1.144.0'}))
  if(kind==='fork')await writeFile(path.join(f.app,'product.json'),JSON.stringify({applicationName:'other',quality:'stable',version:'1.143.1'}))
  if(kind==='portable')await mkdir(path.join(path.dirname(f.bin),'data'))
  if(kind==='flags')await writeFile(path.join(f.app,'out','cli.js'),'missing flags')
  await assert.rejects(checkVSCodeExecutable(f.bin,()=>true),e=>e.code==='client_unsupported')
})
test('installation uses one token-free native entry, preserves normal settings and only removes its exact files',async t=>{
  const f=await fixture(t),normal=path.join(f.root,'normal-settings.json'),other=path.join(f.root,'unrelated-mcp.json')
  const text='{"unrelated":"${PRIVATE_REFERENCE}"}';await writeFile(normal,text);await writeFile(other,text)
  const hash=await f.adapter.install(setup),config=JSON.parse(await readFile(f.files.mcp,'utf8'))
  assert.deepEqual(config,{servers:{[setup.serverName]:{type:'http',url:setup.endpoint,headers:{Authorization:'Bearer ${env:'+setup.envVar+'}'}}}})
  assert.ok(!(await readFile(f.files.mcp,'utf8')).includes(TOKEN));await writeFile(path.join(f.files.root,'user-created.txt'),'preserve')
  await f.adapter.remove(setup,hash);assert.equal(await f.adapter.entry(setup),null)
  assert.equal(await readFile(normal,'utf8'),text);assert.equal(await readFile(other,'utf8'),text)
  assert.equal(await readFile(path.join(f.files.root,'user-created.txt'),'utf8'),'preserve')
  await f.adapter.install(setup);await f.adapter.remove(setup,hash)
})
test('VS Code 1.143 auto-update normalization leaves the canonical off payload unchanged and exact cleanup succeeds',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),original=await readFile(f.files.settings)
  const nativeSettings=JSON.parse(original.toString('utf8'))
  assert.equal(nativeSettings['extensions.autoUpdate'],'off')
  // Observed native migration of legacy booleans. Canonical string settings
  // need no migration, avoiding a cleanup mismatch after an ordinary launch.
  if(typeof nativeSettings['extensions.autoUpdate']==='boolean')nativeSettings['extensions.autoUpdate']=nativeSettings['extensions.autoUpdate']?'on':'off'
  const saved=Buffer.from(JSON.stringify(nativeSettings,null,2)+'\n')
  assert.deepEqual(saved,original);await writeFile(f.files.settings,saved)
  const unexpected=path.join(f.files.root,'unexpected.txt');await writeFile(unexpected,'preserve unexpected content')
  await f.adapter.remove(setup,hash)
  await assert.rejects(access(f.files.settings));await assert.rejects(access(f.files.mcp))
  assert.equal(await readFile(unexpected,'utf8'),'preserve unexpected content')
})
test('cleanup still rejects legacy boolean or re-enabled auto-updates and preserves configuration',async t=>{
  for(const value of [false,'on']){
    const f=await fixture(t),hash=await f.adapter.install(setup)
    const changed=JSON.parse(await readFile(f.files.settings,'utf8'));changed['extensions.autoUpdate']=value
    const text=JSON.stringify(changed,null,2)+'\n';await writeFile(f.files.settings,text)
    await assert.rejects(f.adapter.remove(setup,hash),e=>e.code==='configuration_changed')
    assert.equal(await readFile(f.files.settings,'utf8'),text);await access(f.files.mcp)
  }
})
for(const kind of ['foreign-folder','extra-server','changed-settings','wrong-hash'])test('ownership conflicts are preserved: '+kind,async t=>{
  const f=await fixture(t)
  if(kind==='foreign-folder'){
    await mkdir(f.files.root,{recursive:true});await writeFile(path.join(f.files.root,'keep.txt'),'unrelated')
    await assert.rejects(f.adapter.install(setup),e=>e.code==='configuration_conflict');return
  }
  const hash=await f.adapter.install(setup)
  if(kind==='extra-server')await writeFile(f.files.mcp,JSON.stringify({servers:{[setup.serverName]:vscodeEntry(setup),other:{type:'http',url:'https://example.invalid'}}}))
  if(kind==='changed-settings')await writeFile(f.files.settings,'{"user":"changed"}')
  await assert.rejects(f.adapter.remove(setup,kind==='wrong-hash'?'0'.repeat(64):hash),e=>e.code==='configuration_changed')
  await access(f.files.mcp)
})
test('payload paths cannot escape the owned root or redirect authorization',async t=>{
  const f=await fixture(t)
  for(const change of [{projectId:'../escape'},{endpoint:'https://example.invalid/mcp'},{envVar:'OTHER'},{serverName:'existing'}])assert.throws(()=>vscodePaths(f.home,{...setup,...change}))
})
test('launch arguments isolate user-data, extensions, sync and secret storage without disabling workspace trust',async t=>{
  const f=await fixture(t),args=vscodeLaunchArgs(f.home,setup)
  assert.equal(args[args.indexOf('--user-data-dir')+1],f.files.user);assert.equal(args[args.indexOf('--extensions-dir')+1],f.files.extensions)
  for(const flag of ['--new-window','--disable-updates','--disable-telemetry','--use-inmemory-secretstorage'])assert.ok(args.includes(flag))
  assert.equal(args[args.indexOf('--sync')+1],'off');assert.ok(!args.includes('--disable-workspace-trust'));assert.ok(!args.includes('--install-extension'))
})
test('only child environment gets token; standard homes are isolated and ambient IPC, credentials and preloads are excluded',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup);await f.adapter.launch(setup,TOKEN)
  assert.equal(f.spawned,1);assert.equal(f.snapshot.env[setup.envVar],TOKEN);assert.equal(f.heldEnv[setup.envVar],undefined)
  assert.equal(f.snapshot.env.HOME,f.files.home);assert.equal(f.snapshot.env.USERPROFILE,f.files.home)
  assert.equal(f.snapshot.env.HTTPS_PROXY,f.source.HTTPS_PROXY)
  for(const key of ['VSCODE_IPC_HOOK_CLI','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','OPENAI_API_KEY','SUPABASE_DB_PASSWORD'])assert.equal(f.snapshot.env[key],undefined)
  assert.equal(vscodeEnvironment(f.home,setup,f.source)[setup.envVar],undefined)
  assert.equal(f.source[setup.envVar],TOKEN)
  for(const value of [f.snapshot.args,vscodePayloads(setup),vscodeInstructions(setup),vscodeVerification(),f.adapter.installPreview(setup)])assert.ok(!JSON.stringify(value).includes(TOKEN))
  await f.adapter.remove(setup,hash)
})
test('existing same-user Code instance is preserved; an already-running owned instance is refused',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  f.rows=[...f.baseline,{pid:90,created:'owned',owned:true}]
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='vscode_process_unconfirmed');assert.equal(f.spawned,0)
  f.rows=[...f.baseline];await f.adapter.remove(setup,hash)
})
test('main exit with remaining or uncertain Code processes retains marker; separate disconnect can settle later',async t=>{
  const f=await fixture(t,{leftover:true}),hash=await f.adapter.install(setup)
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='vscode_process_unconfirmed')
  await assert.rejects(f.adapter.remove(setup,hash),e=>e.code==='vscode_process_unconfirmed')
  assert.ok(!(await readFile(f.files.process,'utf8')).includes(TOKEN));assert.equal(f.closed,0)
  f.rows=[...f.baseline];await f.adapter.remove(setup,hash)
  await assert.rejects(access(f.files.process));assert.equal(await f.adapter.entry(setup),null)
})
test('interruption requests only owned window close, revokes via workflow and does not force-kill',async t=>{
  const abort=new AbortController(),f=await fixture(t,{abort}),hash=await f.adapter.install(setup)
  await assert.rejects(f.adapter.launch(setup,TOKEN,abort.signal),e=>e.code==='interrupted')
  assert.equal(f.closed,1);assert.equal(f.heldEnv[setup.envVar],undefined);await f.adapter.remove(setup,hash)
})
test('uncertain spawn acknowledgement and malformed recovery are never automatically bypassed',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  await writeVSCodeFile(f.files.process,Buffer.from(JSON.stringify({version:1,phase:'launching',baseline:[]})))
  await assert.rejects(settleVSCodeRun(f.files.process,f.files.user,f.runtime),e=>e.code==='vscode_process_unconfirmed')
  await assert.rejects(f.adapter.remove(setup,hash),e=>e.code==='vscode_process_unconfirmed')
  await writeFile(f.files.process,'{')
  await assert.rejects(settleVSCodeRun(f.files.process,f.files.user,f.runtime),e=>e.code==='vscode_process_unconfirmed')
})
test('executable replacement and changed config fail before spawning',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  await writeFile(f.bin,'replaced');await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='executable_changed');assert.equal(f.spawned,0)
  await f.adapter.remove(setup,hash)
})
test('verification stays unverified and native start instructions include actual five-tool contract',()=>{
  assert.deepEqual(vscodeVerification(),{authorized:null,verified:false,code:'manual_verification_required'})
  const text=vscodeInstructions(setup);for(const tool of tools)assert.ok(text.includes(tool))
  assert.match(text,/MCP: List Servers/);assert.match(text,/Start Server/);assert.match(text,/File > Exit/)
  assert.equal(safeCode(new ConnectorError('vscode_process_unconfirmed')),'vscode_process_unconfirmed')
})
test('unexpected extensions referenced outside the isolated directory are not launched',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  await writeFile(path.join(f.files.extensions,'extensions.json'),'[{"relativeLocation":"../../unrelated"}]')
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='configuration_changed');assert.equal(f.spawned,0)
  await f.adapter.remove(setup,hash)
})
test('redirected parent directories are refused without modifying their contents',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),other=path.join(f.root,'normal-profile')
  await mkdir(other);await writeFile(path.join(other,'mcp.json'),'normal settings to preserve')
  await f.adapter.remove(setup,hash);await rm(path.join(f.files.user,'User'),{recursive:true})
  await symlink(other,path.join(f.files.user,'User'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(readVSCodeSession(f.home,setup),e=>e.code==='configuration_location_untrusted')
  assert.equal(await readFile(path.join(other,'mcp.json'),'utf8'),'normal settings to preserve')
})
test('cancelled launch never spawns and process-query failure leaves no successful verification',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),signal=AbortSignal.abort()
  await assert.rejects(f.adapter.launch(setup,TOKEN,signal),e=>e.code==='interrupted');assert.equal(f.spawned,0)
  f.runtime.snapshot=async()=>{throw new ConnectorError('vscode_process_unconfirmed')}
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='vscode_process_unconfirmed');assert.equal(f.spawned,0)
  await f.adapter.remove(setup,hash)
})
test('a failed graceful close is bounded, never force-kills and retains recovery evidence',async t=>{
  const abort=new AbortController(),f=await fixture(t,{abort}),hash=await f.adapter.install(setup)
  f.runtime.close=async()=>{throw Error('synthetic failure')}
  await assert.rejects(f.adapter.launch(setup,TOKEN,abort.signal),e=>e.code==='vscode_process_unconfirmed')
  await access(f.files.process);assert.equal(f.heldEnv[setup.envVar],undefined)
  f.rows=[...f.baseline];await f.adapter.remove(setup,hash)
})
for(const failure of ['none','revocation','processes'])test('shared workflow revokes and recovers VS Code without changing other client records: '+failure,async t=>{
  const f=await fixture(t,{leftover:failure==='processes'}),store=new Store(path.join(f.root,'journal')),output=[]
  const project={id:PROJECT,name:'Synthetic',key:'SYNTH',mcp_enabled:true,archived:false}
  let connection,issued=0,revoked=0,failRevoke=failure==='revocation'
  const owner={userId:USER,projects:[project],api:async(route,_method,body)=>{
    if(route.startsWith('/rest/v1/project_members'))return[{user_id:USER,role:'OWNER'}]
    if(route.startsWith('/rest/v1/projects'))return[project]
    if(route.endsWith('/issue_mcp_connection_token')){issued++;connection={id:CONNECTION,project_id:PROJECT,user_id:USER,client_label:body.p_client_label,revoked_at:null};return[{connection_id:CONNECTION,access_token:TOKEN}]}
    if(route.startsWith('/rest/v1/mcp_connections'))return connection?[connection]:[]
    if(route.endsWith('/revoke_mcp_connection')){if(failRevoke)throw new ConnectorError('request_failed');revoked++;connection.revoked_at='synthetic';return null}
    assert.fail('Unexpected route')
  }}
  const others=['codex','gemini','claude'].map(client=>({projectId:PROJECT,userId:USER,client,executable:f.bin,[client+'Home']:path.join(f.root,client),clientLabel:'TrackQA Connect 44444444-4444-4444-8444-444444444444',connectionId:null,phase:'planned',installed:false,configHash:null,lastVerifiedAt:null}))
  for(const record of others)await store.save(record)
  const ui={say:text=>output.push(text),confirm:async()=>true,choose:async()=>0},run=()=>connect({owner,adapter:f.adapter,store,ui,projectId:PROJECT})
  if(failure==='none')await run();else await assert.rejects(run(),e=>e.code==='cleanup_unconfirmed')
  assert.equal(issued,1);assert.equal(project.mcp_enabled,true);assert.ok(!JSON.stringify(output).includes(TOKEN))
  if(failure!=='none'){
    const record=(await store.read()).find(r=>r.client==='vscode');validateRecord(record);assert.equal(record.vscodeHome,f.home);assert.equal(record.lastVerifiedAt,null)
    assert.ok(!JSON.stringify(record).includes(TOKEN));failRevoke=false;f.rows=[...f.baseline]
    await disconnect(store,f.adapter,ui,async action=>action(owner),PROJECT)
  }
  assert.equal(revoked,1);assert.deepEqual(await store.read(),others);assert.equal(await readVSCodeSession(f.home,setup),null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, open, rm, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { claudeAdapter, claudeEnvironment, claudeLaunchArgs, claudeVerification, claudeInstructions, detectClaude, checkClaudeExecutable, trustedClaudeLocation } from '../src/clients/claude.ts'
import { claudeEntry, claudeSessionPath, readClaudeSession } from '../src/clients/claude-session.ts'
import { setupFor, parseArgs, tools, ConnectorError } from '../src/core.ts'
import { Store } from '../src/state.ts'
import { connect, disconnect, status } from '../src/workflow.ts'
import { safeCode } from '../src/cli.ts'

const PROJECT='11111111-1111-4111-8111-111111111111', USER='22222222-2222-4222-8222-222222222222', CONNECTION='33333333-3333-4333-8333-333333333333'
const TOKEN='tqm_'+'a'.repeat(64), setup=setupFor(PROJECT,'claude')
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t, launch=async()=>{}, strict=false) {
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-claude-test-'))
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'trackqa-claude-test-'));await rm(root,{recursive:true,force:true})})
  const sessionHome=path.join(root,'sessions'),bin=path.join(root,'claude.exe')
  await writeFile(bin,'synthetic executable; never executed')
  const exe={path:bin,sha256:digest(await readFile(bin)),version:'2.1.999',appServer:false,foregroundMode:'direct',strictMcp:true}
  const userFile=path.join(root,'.claude.json'),projectFile=path.join(root,'.mcp.json')
  const unrelated=JSON.stringify({mcpServers:{other:{type:'http',url:'https://example.invalid/mcp',headers:{Authorization:'Bearer ${UNRELATED_TOKEN}'}}},theme:'unchanged'})
  await writeFile(userFile,unrelated);await writeFile(projectFile,unrelated)
  const writes=[]
  // Mock the existing Windows private-file writer. No Claude, shell or account process.
  const commit=async(file,expected,bytes)=>{
    assert.deepEqual(expected,{exists:false,hash:null});assert.equal(bytes.includes(TOKEN),false)
    writes.push({file,bytes:bytes.toString('utf8')})
    const handle=await open(file,'wx',0o600)
    try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
  }
  const source={USERPROFILE:root,CLAUDE_CONFIG_DIR:path.join(root,'.claude'),HTTPS_PROXY:'https://synthetic:private@example.invalid',NODE_USE_SYSTEM_CA:'1',
    ANTHROPIC_API_KEY:'synthetic-ai-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-backend-secret',[setup.envVar]:TOKEN}
  const adapter=claudeAdapter(exe,sessionHome,source,strict,launch,commit)
  return {root,sessionHome,bin,exe,source,adapter,commit,writes,userFile,projectFile,unrelated}
}
test('Claude selection and strict opt-in are explicit; all client names and env references remain distinct',()=>{
  assert.deepEqual(parseArgs(['connect','--client','claude','--claude-only']),{command:'connect',client:'claude',claudeOnly:true})
  assert.equal(parseArgs(['connect','--client','claude','--claude-path','C:\\safe\\claude.exe']).executable,'C:\\safe\\claude.exe')
  assert.equal(parseArgs(['connect','--client','claude']).claudeOnly,undefined)
  for(const args of [['connect','--claude-only'],['status','--client','claude','--claude-only'],['connect','--client','codex','--claude-path','x'],['connect','--client','claude','--gemini-path','x'],['connect','--client','claude','--claude-only','--claude-only']]) assert.throws(()=>parseArgs(args))
  for(const key of ['envVar','serverName'])assert.equal(new Set(['codex','gemini','claude'].map(client=>setupFor(PROJECT,client)[key])).size,3)
})
test('detection trusts native CLI locations, never Desktop, npm shims, temporary/repository files or a bare command',async()=>{
  const home='C:\\Users\\owner',cwd='C:\\work\\trackqa',check=file=>trustedClaudeLocation(file,home,'win32',cwd)
  assert.equal(check(home+'\\.local\\bin\\claude.exe'),true)
  assert.equal(check('C:\\Program Files\\ClaudeCode\\claude.exe'),true)
  for(const file of ['claude',cwd+'\\claude.exe',home+'\\Downloads\\claude.exe',home+'\\AppData\\Roaming\\npm\\claude.cmd',home+'\\AppData\\Local\\Programs\\Claude\\Claude.exe','C:\\Program Files\\Claude\\Claude.exe'])assert.equal(check(file),false)
  await assert.rejects(checkClaudeExecutable('claude'),e=>e.code==='executable_untrusted')
})
test('missing Claude never invokes a process or installs anything',async()=>{
  let calls=0
  await assert.rejects(detectClaude(undefined,{PATH:''},async()=>{calls++;return ''},async()=>{throw Error('not installed')}),e=>e.code==='client_not_found')
  assert.equal(calls,0)
})
test('version and help capability checks use disposable settings and no account or MCP commands',async t=>{
  const f=await fixture(t),calls=[]
  const exe=await detectClaude(f.bin,f.source,async(file,args,env,spawn,cwd)=>{
    calls.push({file,args,env:{...env},cwd})
    assert.equal(env[setup.envVar],undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined)
    assert.equal(cwd,env.CLAUDE_CONFIG_DIR);assert.notEqual(cwd,f.source.CLAUDE_CONFIG_DIR)
    assert.equal(env.DISABLE_UPDATES,'1')
    return args[0]==='--version'?'2.1.999 (Claude Code)':'--mcp-config --strict-mcp-config'
  },async()=>f.exe)
  assert.equal(exe.version,'2.1.999');assert.equal(exe.appServer,false)
  assert.deepEqual(calls.map(c=>c.args),[['--version'],['--help']])
  await assert.rejects(readFile(path.join(calls[0].cwd,'anything')),e=>e.code==='ENOENT')
})
for(const failure of ['version','help','replacement'])test('Claude detection fails closed for '+failure,async t=>{
  const f=await fixture(t)
  await assert.rejects(detectClaude(f.bin,{},async(_file,args)=>{
    if(args[0]==='--version')return failure==='version'?'not Claude':'2.1.999 (Claude Code)'
    if(failure==='replacement')await writeFile(f.bin,'changed')
    return failure==='help'?'incompatible help':'--mcp-config --strict-mcp-config'
  },async()=>f.exe),e=>e.code===(failure==='replacement'?'executable_changed':'client_unsupported'))
})
test('temporary HTTP configuration has only one owned server and a literal header; real settings remain byte-identical',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup),file=claudeSessionPath(f.sessionHome,setup)
  const bytes=await readFile(file,'utf8'),config=JSON.parse(bytes)
  assert.deepEqual(Object.keys(config),['mcpServers']);assert.deepEqual(Object.keys(config.mcpServers),[setup.serverName])
  assert.deepEqual(config.mcpServers[setup.serverName],{type:'http',url:setup.endpoint,headers:{Authorization:'Bearer ${'+setup.envVar+'}'}})
  assert.ok(!bytes.includes(TOKEN));assert.equal(f.writes.length,1)
  assert.equal(await readFile(f.userFile,'utf8'),f.unrelated);assert.equal(await readFile(f.projectFile,'utf8'),f.unrelated)
  await assert.rejects(f.adapter.install(setup),e=>e.code==='configuration_conflict')
  await f.adapter.remove(setup,hash)
  assert.equal(await f.adapter.entry(setup),null);assert.deepEqual(await readdir(f.sessionHome),[])
  assert.equal(await readFile(f.userFile,'utf8'),f.unrelated);assert.equal(await readFile(f.projectFile,'utf8'),f.unrelated)
})
for(const change of ['malformed','extra-server','token','different-header'])test('unexpected session configuration is neither launched nor deleted: '+change,async t=>{
  let launched=false
  const f=await fixture(t,async()=>{launched=true}),hash=await f.adapter.install(setup),file=claudeSessionPath(f.sessionHome,setup)
  const entry=claudeEntry(setup)
  const bytes=change==='malformed'?'{':JSON.stringify({mcpServers:{[setup.serverName]:{...entry,headers:{Authorization:change==='token'?'Bearer '+TOKEN:change==='different-header'?'Bearer ${OTHER}':entry.headers.Authorization}},...(change==='extra-server'?{other:entry}:{})}})
  await writeFile(file,bytes)
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='configuration_changed')
  await assert.rejects(f.adapter.remove(setup,hash),e=>e.code==='configuration_changed')
  assert.equal(launched,false);assert.equal(await readFile(file,'utf8'),bytes)
})
test('session path cannot escape its recovery root or change the configured backend',async t=>{
  const f=await fixture(t)
  for(const value of [{...setup,projectId:'../escape'},{...setup,endpoint:'https://example.invalid/mcp'},{...setup,envVar:'ANTHROPIC_API_KEY'},{...setup,serverName:'unrelated'}])assert.throws(()=>claudeSessionPath(f.sessionHome,value))
})
test('foreground uses only --mcp-config by default, a process-only token and ordinary permission behavior',async t=>{
  let snapshot,heldEnv
  const f=await fixture(t,async(file,env,signal,spawn,args)=>{snapshot={file,env:{...env},args};heldEnv=env;await Promise.resolve()})
  const hash=await f.adapter.install(setup);await f.adapter.launch(setup,TOKEN)
  assert.deepEqual(snapshot.args,['--mcp-config',claudeSessionPath(f.sessionHome,setup)])
  assert.equal(snapshot.env[setup.envVar],TOKEN);assert.equal(heldEnv[setup.envVar],undefined)
  assert.equal(snapshot.env.HTTPS_PROXY,f.source.HTTPS_PROXY);assert.equal(snapshot.env.NODE_USE_SYSTEM_CA,'1')
  assert.equal(snapshot.env.CLAUDE_CONFIG_DIR,f.source.CLAUDE_CONFIG_DIR)
  assert.equal(snapshot.env.ANTHROPIC_API_KEY,undefined);assert.equal(snapshot.env.SUPABASE_SERVICE_ROLE_KEY,undefined)
  for(const value of [snapshot.args,f.adapter.installPreview(setup),claudeInstructions(setup),claudeVerification(),f.writes]){
    assert.ok(!JSON.stringify(value).includes(TOKEN));assert.ok(!JSON.stringify(value).includes(f.source.HTTPS_PROXY))
  }
  await f.adapter.remove(setup,hash)
})
test('strict mode is opt-in and its preview explains other servers will be excluded for this session',async t=>{
  const f=await fixture(t,async(_file,_env,_signal,_spawn,args)=>assert.ok(args.includes('--strict-mcp-config')),true)
  const hash=await f.adapter.install(setup);await f.adapter.launch(setup,TOKEN)
  assert.match(f.adapter.installPreview(setup),/explicit TrackQA-only session: excludes other configured MCP servers/)
  assert.equal(claudeLaunchArgs('file').includes('--strict-mcp-config'),false)
  await f.adapter.remove(setup,hash)
})
test('strict mode cannot be requested unless the selected executable advertises it',async t=>{
  const f=await fixture(t)
  const exe=await detectClaude(f.bin,{},async(_file,args)=>args[0]==='--version'?'2.1.999 (Claude Code)':'--mcp-config',async()=>f.exe)
  assert.equal(exe.strictMcp,false)
  assert.doesNotThrow(()=>claudeAdapter(exe,f.sessionHome))
  assert.throws(()=>claudeAdapter(exe,f.sessionHome,{},true),e=>e.code==='client_unsupported')
})
test('child environment excludes ambient credentials, debug/preloads and TLS bypass without changing the parent',()=>{
  const source={PATH:'safe-path',SystemDrive:'C:',NODE_USE_SYSTEM_CA:'1',NODE_TLS_REJECT_UNAUTHORIZED:'0',NODE_OPTIONS:'--require unsafe',
    DEBUG:'sensitive',GEMINI_API_KEY:'private',ANTHROPIC_AUTH_TOKEN:'private',SUPABASE_DB_PASSWORD:'private',[setup.envVar]:TOKEN}
  const env=claudeEnvironment(source)
  assert.equal(env.PATH,'safe-path');assert.equal(env.SystemDrive,'C:');assert.equal(env.NODE_USE_SYSTEM_CA,'1')
  for(const key of ['NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','DEBUG','GEMINI_API_KEY','ANTHROPIC_AUTH_TOKEN','SUPABASE_DB_PASSWORD',setup.envVar])assert.equal(env[key],undefined)
  assert.equal(source[setup.envVar],TOKEN);assert.equal(env.DISABLE_UPDATES,'1');assert.equal(env.DISABLE_AUTOUPDATER,'1')
})
test('failure and interruption clear parent token references and preserve fixed diagnostics',async t=>{
  for(const code of ['client_exit_failed','interrupted']){
    let heldEnv
    const f=await fixture(t,async(_file,env)=>{heldEnv=env;throw new ConnectorError(code)})
    const hash=await f.adapter.install(setup)
    await assert.rejects(f.adapter.launch(setup,TOKEN),e=>safeCode(e)===code&&!e.message.includes(TOKEN))
    assert.equal(heldEnv[setup.envVar],undefined);await f.adapter.remove(setup,hash)
  }
})
test('discovery and authorized reads remain explicitly unverified, not inferred from process startup',()=>{
  assert.deepEqual(claudeVerification(),{authorized:null,verified:false,code:'manual_verification_required'})
  for(const name of tools)assert.ok(claudeInstructions(setup).includes(name))
  assert.match(claudeInstructions(setup),/Do not submit a finding/)
})
test('changed executable and missing session file are refused before token injection',async t=>{
  const f=await fixture(t,async()=>assert.fail('must not launch'))
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='configuration_changed')
  const hash=await f.adapter.install(setup);await writeFile(f.bin,'replaced')
  await assert.rejects(f.adapter.launch(setup,TOKEN),e=>e.code==='executable_changed')
  await f.adapter.remove(setup,hash)
})
test('interruption after the private file is created is recoverable before its hash was journaled',async t=>{
  const f=await fixture(t),adapter=claudeAdapter(f.exe,f.sessionHome,{},false,async()=>assert.fail('must not launch'),async(...args)=>{
    await f.commit(...args);throw new ConnectorError('configuration_write_uncertain')
  })
  await assert.rejects(adapter.install(setup),e=>e.code==='configuration_write_uncertain')
  await adapter.remove(setup,null);assert.equal(await readClaudeSession(f.sessionHome,setup),null)
})
for(const failure of ['none','interrupted','revocation','local-removal'])test('existing workflow with real Claude adapter handles '+failure+' and keeps other client journals',async t=>{
  const f=await fixture(t,async()=>{if(failure==='interrupted')throw new ConnectorError('interrupted')})
  const store=new Store(path.join(f.root,'journal')),output=[],project={id:PROJECT,name:'Synthetic',key:'SYNTH',archived:false,mcp_enabled:true}
  let connection=null,issued=0,revoked=0,failRevoke=failure==='revocation'
  const owner={userId:USER,projects:[project],api:async(route,method='GET',body)=>{
    if(route.startsWith('/rest/v1/project_members'))return [{user_id:USER,role:'OWNER'}]
    if(route.startsWith('/rest/v1/projects')){assert.equal(method,'GET');return [project]}
    if(route.endsWith('/issue_mcp_connection_token')){issued++;connection={id:CONNECTION,project_id:PROJECT,user_id:USER,client_label:body.p_client_label,revoked_at:null};return [{connection_id:CONNECTION,access_token:TOKEN}]}
    if(route.startsWith('/rest/v1/mcp_connections'))return connection?[connection]:[]
    if(route.endsWith('/revoke_mcp_connection')){if(failRevoke)throw new ConnectorError('request_failed');revoked++;connection.revoked_at='synthetic timestamp';return null}
    assert.fail('Unexpected RPC')
  }}
  const other=['codex','gemini'].map(client=>({projectId:PROJECT,userId:USER,client,executable:f.bin,
    [client==='codex'?'codexHome':'geminiHome']:path.join(f.root,client),clientLabel:'TrackQA Connect 44444444-4444-4444-8444-444444444444',
    connectionId:null,phase:'planned',installed:false,configHash:null,lastVerifiedAt:null}))
  for(const record of other)await store.save(record)
  const ui={say:line=>output.push(line),confirm:async()=>true,choose:async()=>0}
  const originalRemove=f.adapter.remove
  if(failure==='local-removal')f.adapter.remove=async()=>{throw new ConnectorError('removal_unconfirmed')}
  const run=()=>connect({owner,adapter:f.adapter,store,ui,projectId:PROJECT})
  if(failure==='none')await run();else await assert.rejects(run(),e=>e.code===(failure==='interrupted'?'interrupted':'cleanup_unconfirmed'))
  assert.equal(issued,1);assert.equal(project.mcp_enabled,true)
  assert.ok(!JSON.stringify(output).includes(TOKEN));assert.ok(!JSON.stringify(await store.read()).includes(TOKEN))
  assert.ok(output.some(line=>line.includes('Authorized: not verified. Verified working: no.')))
  if(failure==='revocation'||failure==='local-removal'){
    const record=(await store.read()).find(r=>r.client==='claude')
    assert.equal(record.claudeHome,f.sessionHome);assert.equal(record.codexHome,undefined)
    assert.equal(record.phase,failure==='revocation'?'revocation_pending':'revoked')
    assert.equal(record.lastVerifiedAt,null)
    failRevoke=false;f.adapter.remove=originalRemove
    await disconnect(store,f.adapter,ui,async action=>action(owner),PROJECT)
  }
  assert.equal(revoked,1);assert.deepEqual(await store.read(),other)
  await status(store,f.adapter,ui);assert.match(output.at(-1),/No connector-managed/)
  assert.equal(await readFile(f.userFile,'utf8'),f.unrelated);assert.equal(await readFile(f.projectFile,'utf8'),f.unrelated)
})

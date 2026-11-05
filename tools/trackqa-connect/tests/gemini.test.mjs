import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import os from 'node:os'
import { geminiAdapter, detectGemini, probeGemini, trustedGeminiLocation, checkGeminiInstallation, geminiAddArgs, geminiEnvironment, inheritGeminiNetworkEnvironment, matchesGeminiEntry, assertNoAutoUpdate } from '../src/clients/gemini.ts'
import { assessGeminiDiscovery, geminiInstructions, geminiVerification } from '../src/clients/gemini-verify.ts'
import { setupFor, parseArgs, tools, ConnectorError } from '../src/core.ts'
import { capture, foreground } from '../src/process.ts'
import { safeCode } from '../src/cli.ts'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const setup = setupFor(PROJECT, 'gemini'), TOKEN = 'tqm_' + 'a'.repeat(64)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
// Isolated fake npm bin. Actual subprocess tests exercise our Node invocation,
// argument/environment boundaries and native-command checks, NOT Gemini itself.
const fixtureCli = `
import fs from 'node:fs'; import path from 'node:path';
const args=process.argv.slice(2), home=process.env.GEMINI_CLI_HOME;
const file=path.join(home,'.gemini','settings.json');
const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
if(args[0]==='--version'){console.log('0.50.0');process.exit(0)}
if(args.includes('--help')){console.log('Gemini mcp list --scope --transport --header');process.exit(0)}
if(process.env.TRACKQA_UNEXPECTED || Object.keys(process.env).some(k=>k.startsWith('TRACKQA_MCP_TOKEN')))process.exit(11);
const value=read();value.mcpServers??={};
if(args[1]==='add'){
 if(args[2]!=='--scope'||args[3]!=='user'||args[4]!=='--transport'||args[5]!=='http'||args[6]!=='--header')process.exit(12);
 const header=args[7].slice('Authorization: '.length);
 value.mcpServers[args[8]]={httpUrl:args[9],headers:{Authorization:header}};
} else if(args[1]==='remove')delete value.mcpServers[args[4]];
else process.exit(13);
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));
`
async function fixture(t, source = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trackqa-gemini-test-'))
  t.after(async () => { assert.ok(root.startsWith(path.join(os.tmpdir(), 'trackqa-gemini-test-'))); await rm(root,{recursive:true,force:true}) })
  const bin = path.join(root, 'index.mjs'), packageFile = path.join(root, 'package.json'), home = path.join(root, 'home')
  await writeFile(bin, fixtureCli); await writeFile(packageFile, '{"name":"@google/gemini-cli","version":"0.50.0"}')
  await mkdir(path.join(home, '.gemini'), { recursive:true })
  const nodePath = await import('node:fs/promises').then(fs=>fs.realpath(process.execPath))
  const exe = {path:bin,sha256:digest(await readFile(bin)),nodePath,nodeHash:digest(await readFile(nodePath)),packageFile,
    packageHash:digest(await readFile(packageFile)),version:'0.50.0',appServer:false,foregroundMode:'direct'}
  const file = path.join(home, '.gemini', 'settings.json')
  const original = {general:{enableAutoUpdate:false},ui:{theme:'Default'},mcpServers:{other:{httpUrl:'https://example.invalid',headers:{Authorization:'Bearer ${OTHER_TOKEN}'}}}}
  await writeFile(file, JSON.stringify(original))
  const calls=[]
  const run=async (file,args,env,spawn,cwd)=>{ calls.push({file,args:[...args],env:{...env},cwd});return capture(file,args,env,spawn,cwd) }
  const adapter=geminiAdapter(exe,home,run,source)
  return {root,home,file,bin,packageFile,exe,original,calls,run,adapter}
}
test('Gemini CLI arguments are explicit and cannot be confused with another client',()=>{
  assert.equal(parseArgs(['connect','--client','gemini','--gemini-path','C:\\safe\\index.js']).client,'gemini')
  for (const args of [['connect','--client','codex','--gemini-path','x'],['connect','--client','gemini','--codex-path','x'],['connect','--gemini-path','x']]) assert.throws(()=>parseArgs(args))
  assert.notEqual(setup.serverName,setupFor(PROJECT).serverName);assert.notEqual(setup.envVar,setupFor(PROJECT).envVar)
})
test('only known Gemini npm installations qualify; agy and arbitrary wrappers never do',async()=>{
  const home='C:\\Users\\owner',cwd='C:\\work\\trackqa'
  const check=file=>trustedGeminiLocation(file,home,'win32',cwd)
  assert.ok(check(home+'\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js'))
  for(const file of [home+'\\.gemini\\bin\\agy.exe',home+'\\Downloads\\gemini.cmd',cwd+'\\node_modules\\@google\\gemini-cli\\dist\\index.js','gemini'])assert.equal(check(file),false)
  await assert.rejects(checkGeminiInstallation(home+'\\.gemini\\bin\\agy.exe'),e=>e.code==='executable_untrusted')
})
test('missing Gemini is reported without invoking any process or installing software',async()=>{
  let ran=false
  await assert.rejects(detectGemini(undefined,{PATH:''},async()=>{ran=true;return ''},async()=>{throw new Error('missing')}),e=>e.code==='client_not_found')
  assert.equal(ran,false)
})

test('Gemini detects the bundled npm entry as well as the legacy dist layout through existing validation and probes', async t => {
  const f = await fixture(t), prefix = path.join(f.root, 'npm'), candidates = []
  const bundled = path.join(prefix, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')
  const detected = await detectGemini(undefined, { PATH: prefix }, f.run, async file => {
    candidates.push(file)
    if (file !== bundled) throw new Error('Not installed')
    return f.exe
  })
  assert.deepEqual(candidates, [path.join(prefix, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js'), bundled])
  assert.equal(detected.path, f.exe.path)
  assert.equal(detected.capabilities.rawEditorPreservesUnrelated, true)
})
test('installed Gemini native compatibility (opt-in, isolated settings, no hosted requests)',{
  skip:!process.env.TRACKQA_NATIVE_GEMINI,
},async()=>{
  const executable=await detectGemini(process.env.TRACKQA_NATIVE_GEMINI)
  assert.equal(executable.appServer,false)
  assert.equal(executable.foregroundMode,'direct')
  assert.equal(executable.capabilities.rawEditorPreservesUnrelated,true)
  assert.equal(executable.capabilities.rawEditorRemoval,true)
  if(executable.version==='0.66.0')assert.equal(executable.capabilities.nativeAddPreservesUnrelated,false)
})
test('actual isolated add/remove probe checks version, capabilities, literal headers and unrelated settings',async t=>{
  const f=await fixture(t)
  const found=await detectGemini(f.bin,{},f.run,async()=>f.exe)
  assert.equal(found.version,'0.50.0')
  assert.ok(f.calls.some(c=>c.args.includes('--version')))
  assert.ok(f.calls.some(c=>c.args.includes('add')))
  assert.ok(f.calls.every(c=>c.cwd&&c.cwd!==process.cwd()))
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),f.original,'probe must not touch the real client home')
  for(const c of f.calls)assert.ok(!JSON.stringify(c).includes(TOKEN))
})
for(const failure of ['version','capability','expansion','remove'])test('native compatibility probe fails closed: '+failure,async t=>{
  const f=await fixture(t)
  const run=async(file,args,env,spawn,cwd)=>{
    if(failure==='version'&&args.includes('--version'))return 'not-gemini'
    if(failure==='capability'&&args.includes('--help'))return 'unsupported'
    const result=await f.run(file,args,env,spawn,cwd)
    const target=path.join(env.GEMINI_CLI_HOME,'.gemini','settings.json')
    if(args.includes('add')&&failure==='expansion'){
      const data=JSON.parse(await readFile(target,'utf8'))
      data.mcpServers.trackqa_compatibility_probe.headers.Authorization='Bearer expanded'
      await writeFile(target,JSON.stringify(data))
    }
    if(failure==='remove'&&args.includes('remove'))await writeFile(target,JSON.stringify({mcpServers:{trackqa_compatibility_probe:{httpUrl:'https://example.invalid/mcp'}}}))
    return result
  }
  await assert.rejects(probeGemini(f.exe,run),e=>e.code==='gemini_compatibility_unverified')
  assert.equal(safeCode(new ConnectorError('gemini_compatibility_unverified')),'gemini_compatibility_unverified')
})
test('unsafe native expansion is reported separately; the raw editor must independently preserve unrelated references',async t=>{
  const f=await fixture(t)
  const report=await probeGemini(f.exe,async(file,args,env,spawn,cwd)=>{
    const result=await f.run(file,args,env,spawn,cwd)
    if(args.includes('add')&&!args.includes('--help')){
      const target=path.join(env.GEMINI_CLI_HOME,'.gemini','settings.json'),data=JSON.parse(await readFile(target,'utf8'))
      data.mcpServers.unrelated.headers.Authorization='Bearer compatibility-sentinel-not-a-credential'
      await writeFile(target,JSON.stringify(data))
    }
    return result
  })
  assert.equal(report.nativeAddPreservesUnrelated,false)
  assert.equal(report.rawEditorPreservesUnrelated,true);assert.equal(report.rawEditorRemoval,true)
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),f.original)
})
test('native arguments contain only literal env references; management never receives bearer or AI credentials',async t=>{
  const f=await fixture(t,{[setup.envVar]:TOKEN,GEMINI_API_KEY:'synthetic-ai-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',NODE_OPTIONS:'--require unsafe'})
  const hash=await f.adapter.install(setup)
  const args=geminiAddArgs(setup)
  assert.ok(args.includes('Authorization: Bearer ${'+setup.envVar+'}'))
  assert.ok(!args.includes('--trust'))
  for(const c of f.calls){assert.ok(!JSON.stringify(c).includes(TOKEN));assert.equal(c.env.GEMINI_API_KEY,undefined);assert.equal(c.env.NODE_OPTIONS,undefined)}
  assert.ok(!(await readFile(f.file,'utf8')).includes(TOKEN))
  await f.adapter.remove(setup,hash)
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),f.original)
})
test('both documented and current native HTTP forms match; SSE, plaintext, extra auth and trusted tool bypass do not',()=>{
  const headers={Authorization:'Bearer ${'+setup.envVar+'}'}
  assert.ok(matchesGeminiEntry({httpUrl:setup.endpoint,headers},setup))
  assert.ok(matchesGeminiEntry({url:setup.endpoint,type:'http',headers},setup))
  for(const row of [{url:setup.endpoint,headers},{url:setup.endpoint,type:'sse',headers},{httpUrl:setup.endpoint,headers:{Authorization:TOKEN}},{httpUrl:setup.endpoint,headers,trust:true},{httpUrl:setup.endpoint,headers,command:'evil'},{httpUrl:setup.endpoint,headers:{...headers,Other:'secret'}}])assert.equal(matchesGeminiEntry(row,setup),false)
})
test('conflicts and user-edited Gemini entries are preserved',async t=>{
  const f=await fixture(t),hash=await f.adapter.install(setup)
  await assert.rejects(f.adapter.install(setup),e=>e.code==='configuration_conflict')
  const data=JSON.parse(await readFile(f.file,'utf8'));data.mcpServers[setup.serverName].timeout=999
  await writeFile(f.file,JSON.stringify(data))
  await assert.rejects(f.adapter.remove(setup,hash),e=>e.code==='configuration_changed')
  assert.equal(JSON.parse(await readFile(f.file,'utf8')).mcpServers[setup.serverName].timeout,999)
})
test('real settings installation/removal never invokes native mutation commands',async t=>{
  const f=await fixture(t)
  const adapter=geminiAdapter(f.exe,f.home,async()=>{throw new Error('Native writer must never run')},{})
  const hash=await adapter.install(setup);await adapter.remove(setup,hash)
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),f.original)
  assert.equal(f.calls.length,0)
})
for(const file of ['bin','packageFile'])test('executable/package replacement stops native commands: '+file,async t=>{
  const f=await fixture(t);await writeFile(f[file],'replacement')
  await assert.rejects(f.adapter.install(setup),e=>e.code==='executable_changed')
  assert.equal(f.calls.length,0)
})
test('Gemini verification never substitutes startup or native list status for discovery and authenticated reads',async t=>{
  const f=await fixture(t)
  assert.deepEqual(await f.adapter.verify(setup,TOKEN),{authorized:null,verified:false,code:'manual_verification_required'})
  assert.deepEqual(geminiVerification(),await f.adapter.verify(setup,TOKEN))
  assert.equal(f.calls.length,0,'verification must not pass the bearer to a configuration process')
  assert.equal(assessGeminiDiscovery(tools).complete,true)
  assert.equal(assessGeminiDiscovery(tools.slice(0,4)).complete,false)
  assert.equal(assessGeminiDiscovery([...tools,tools[0]]).complete,false)
  assert.equal(assessGeminiDiscovery(tools).authenticatedReadsVerified,false)
  const message=geminiInstructions(setup)
  for(const name of tools)assert.ok(message.includes(name))
  assert.ok(message.includes('not machine-verified'));assert.ok(!message.includes(TOKEN))
})
test('foreground uses the actual Node bin, inherits the terminal and injects the bearer only into its child',async t=>{
  const f=await fixture(t);await f.adapter.install(setup)
  let heldEnv,snapshot
  const adapter=geminiAdapter(f.exe,f.home,f.run,{[setup.envVar]:'ambient-token',SUPABASE_DB_PASSWORD:'synthetic-db',OPENAI_API_KEY:'synthetic-openai'},async(file,env,signal,spawn,args)=>{
    assert.equal(file,f.exe.nodePath);assert.deepEqual(args,[f.exe.path]);assert.equal(spawn,undefined)
    heldEnv=env;snapshot={...env};await Promise.resolve()
  })
  await adapter.launch(setup,TOKEN)
  assert.equal(snapshot[setup.envVar],TOKEN);assert.equal(heldEnv[setup.envVar],undefined)
  assert.equal(snapshot.SUPABASE_DB_PASSWORD,undefined);assert.equal(snapshot.OPENAI_API_KEY,undefined)
})
test('interrupted Gemini foreground stops only its child and releases credential references',async t=>{
  const f=await fixture(t);await f.adapter.install(setup)
  const stop=new AbortController();let killed=0,heldEnv
  const spawn=(file,args,options)=>{
    assert.equal(file,f.exe.nodePath);assert.deepEqual(args,[f.exe.path]);assert.equal(options.stdio,'inherit')
    heldEnv=options.env;const child=new EventEmitter()
    child.kill=()=>{killed++;queueMicrotask(()=>child.emit('exit',null))}
    queueMicrotask(()=>stop.abort());return child
  }
  const adapter=geminiAdapter(f.exe,f.home,f.run,{},(file,env,signal,_spawn,args)=>foreground(file,env,signal,spawn,args))
  await assert.rejects(adapter.launch(setup,TOKEN,stop.signal),e=>e.code==='interrupted')
  assert.equal(killed,1);assert.equal(heldEnv[setup.envVar],undefined)
})
test('Gemini environment allows its own account settings without inheriting other client or TrackQA credentials',()=>{
  const source={GEMINI_API_KEY:'own-key',GOOGLE_CLOUD_PROJECT:'own-project',OPENAI_API_KEY:'not-gemini',TRACKQA_MCP_TOKEN:TOKEN,NODE_OPTIONS:'unsafe',GEMINI_CLI_IDE_PID:'123'}
  const env=geminiEnvironment('home',source,true)
  assert.equal(env.GEMINI_API_KEY,'own-key');assert.equal(env.GOOGLE_CLOUD_PROJECT,'own-project')
  for(const name of ['OPENAI_API_KEY','TRACKQA_MCP_TOKEN','NODE_OPTIONS','GEMINI_CLI_IDE_PID'])assert.equal(env[name],undefined)
})
for(const name of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy','NODE_USE_SYSTEM_CA'])test('Gemini inherits only the existing recognized network setting: '+name,()=>{
  const source={[name]:name==='NODE_USE_SYSTEM_CA'?'1':'synthetic-network-value'}
  const env=geminiEnvironment('test-home',source)
  assert.ok(Object.keys(env).some(key=>key.toLowerCase()===name.toLowerCase()&&env[key]===source[name]))
  assert.deepEqual(source,{[name]:source[name]},'source is not modified')
})
test('absent network settings remain absent; explicit empty values are retained',()=>{
  const env=geminiEnvironment('test-home',{HTTPS_PROXY:undefined,NO_PROXY:''})
  assert.equal(Object.hasOwn(env,'HTTP_PROXY'),false)
  assert.equal(Object.hasOwn(env,'HTTPS_PROXY'),false)
  assert.equal(env.NO_PROXY,'')
  assert.equal(Object.hasOwn(env,'NODE_USE_SYSTEM_CA'),false)
})
test('explicit child network settings win without mutating either input, including Windows casing',()=>{
  const child={HTTPS_PROXY:'child-network-value',NO_PROXY:'',NODE_USE_SYSTEM_CA:'1'}
  const source={HTTPS_PROXY:'parent-network-value',NO_PROXY:'parent-bypass',NODE_USE_SYSTEM_CA:'0'}
  assert.deepEqual(inheritGeminiNetworkEnvironment(child,source),child)
  assert.equal(child.HTTPS_PROXY,'child-network-value');assert.equal(source.HTTPS_PROXY,'parent-network-value')
  if(process.platform==='win32')assert.deepEqual(inheritGeminiNetworkEnvironment({https_proxy:''},{HTTPS_PROXY:'parent-network-value'}),{https_proxy:''})
})
test('network inheritance never imports TLS-disable, preload, ambient bearer, or privileged credentials',()=>{
  const source={HTTPS_PROXY:'synthetic-network-value',NODE_USE_SYSTEM_CA:'1',NODE_TLS_REJECT_UNAUTHORIZED:'0',NODE_OPTIONS:'--require unsafe',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret',TRACKQA_MCP_TOKEN:TOKEN,ARBITRARY:'synthetic-secret'}
  const env=geminiEnvironment('test-home',source)
  assert.equal(env.HTTPS_PROXY,'synthetic-network-value');assert.equal(env.NODE_USE_SYSTEM_CA,'1')
  for(const key of ['NODE_TLS_REJECT_UNAUTHORIZED','NODE_OPTIONS','SUPABASE_SERVICE_ROLE_KEY','TRACKQA_MCP_TOKEN','ARBITRARY'])assert.equal(env[key],undefined)
})
test('credential-bearing proxy stays only in the launch environment, not arguments, config, or diagnostics',async t=>{
  const f=await fixture(t);const secret='synthetic-proxy-password'
  const proxy='http://synthetic-user:'+secret+'@127.0.0.1:9999'
  let childSnapshot,heldEnv
  const adapter=geminiAdapter(f.exe,f.home,f.run,{HTTPS_PROXY:proxy,NO_PROXY:'localhost,127.0.0.1',NODE_USE_SYSTEM_CA:'1'},async(file,env,signal,spawn,args)=>{
    assert.equal(file,f.exe.nodePath);childSnapshot={...env};heldEnv=env
    assert.equal(args.join(' ').includes(secret),false);assert.equal(args.join(' ').includes(TOKEN),false)
    await Promise.resolve()
  })
  const before=await readFile(f.file,'utf8'),hash=await adapter.install(setup)
  const preview=adapter.installPreview(setup),verification=await adapter.verify(setup,TOKEN)
  await adapter.launch(setup,TOKEN)
  assert.ok(childSnapshot.HTTPS_PROXY===proxy,'proxy reaches the child without printing its value')
  assert.equal(childSnapshot.NODE_USE_SYSTEM_CA,'1');assert.equal(childSnapshot[setup.envVar],TOKEN)
  assert.equal(heldEnv[setup.envVar],undefined)
  for(const output of [await readFile(f.file,'utf8'),preview,JSON.stringify(verification),JSON.stringify(f.calls)]){
    assert.equal(output.includes(secret),false);assert.equal(output.includes(proxy),false);assert.equal(output.includes(TOKEN),false)
  }
  await adapter.remove(setup,hash)
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),JSON.parse(before))
})
test('automatic updates must be disabled explicitly; the adapter never changes that preference',async t=>{
  const f=await fixture(t),before=await readFile(f.file,'utf8')
  await assertNoAutoUpdate(f.home,{},f.root)
  assert.equal(await readFile(f.file,'utf8'),before)
  for(const value of [true,undefined]){
    const data={...f.original,general:{enableAutoUpdate:value}}
    await writeFile(f.file,JSON.stringify(data))
    await assert.rejects(f.adapter.prepare(),e=>e.code==='gemini_auto_update_enabled')
  }
  assert.equal(f.calls.length,0)
})
for(const scope of ['workspace','system'])test('auto-update '+scope+' override blocks a foreground launch without modifying settings',async t=>{
  const f=await fixture(t),override=path.join(f.root,'system.json')
  const workspace=path.join(f.root,'workspace');await mkdir(path.join(workspace,'.gemini'),{recursive:true})
  const file=scope==='workspace'?path.join(workspace,'.gemini','settings.json'):override
  await writeFile(file,JSON.stringify({general:{enableAutoUpdate:true}}))
  const source=scope==='system'?{GEMINI_CLI_SYSTEM_SETTINGS_PATH:override}:{}
  await assert.rejects(assertNoAutoUpdate(f.home,source,workspace),e=>e.code==='gemini_auto_update_enabled')
  assert.equal(JSON.parse(await readFile(file,'utf8')).general.enableAutoUpdate,true)
})

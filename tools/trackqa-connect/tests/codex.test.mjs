import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { setupFor, tools } from '../src/core.ts'
import { codexAdapter, detectCodex } from '../src/clients/codex.ts'
import { verifyCodex } from '../src/clients/codex-verify.ts'
import { capture, foreground } from '../src/process.ts'

const PROJECT='11111111-1111-4111-8111-111111111111'
const TOKEN='tqm_'+'a'.repeat(64)
const setup=setupFor(PROJECT)
async function temporary(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-connect-native-'))
  t.after(async()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'trackqa-connect-native-')));await rm(root,{recursive:true,force:true})})
  return root
}
test('native adapter uses only token-free add/remove arguments, rejects duplicates and preserves unrelated settings',async t=>{
  const home=await temporary(t), file=path.join(home,'codex-mock.exe')
  await writeFile(file,'mock executable bytes')
  const exe={path:file,sha256:createHash('sha256').update(await readFile(file)).digest('hex'),version:'mock',appServer:false}
  const entries=new Map([['other',{name:'other',enabled:true,transport:{type:'stdio',command:'untouched'}}]])
  const calls=[]
  const run=async(_file,args)=>{
    calls.push(args)
    if(args[1]==='list')return JSON.stringify([...entries.values()])
    if(args[1]==='get')return JSON.stringify(entries.get(args[2]))
    if(args[1]==='add') {entries.set(args[2],{name:args[2],enabled:true,transport:{type:'streamable_http',url:args[4],bearer_token_env_var:args[6],http_headers:null,env_http_headers:null}});return ''}
    if(args[1]==='remove'){entries.delete(args[2]);return ''}
    throw new Error('Unexpected command')
  }
  const adapter=codexAdapter(exe,home,run,{})
  const hash=await adapter.install(setup)
  await assert.rejects(adapter.install(setup),error=>error.code==='configuration_conflict')
  assert.ok(!JSON.stringify(calls).includes(TOKEN))
  assert.ok(!JSON.stringify(entries.get(setup.serverName)).includes(TOKEN))
  entries.get(setup.serverName).enabled=false
  await assert.rejects(adapter.remove(setup,hash),error=>error.code==='configuration_changed')
  entries.get(setup.serverName).enabled=true
  await adapter.remove(setup,hash)
  assert.deepEqual([...entries.keys()],['other'])
  await writeFile(file,'replacement executable')
  await assert.rejects(adapter.entry(setup),error=>error.code==='configuration_unreadable')
})
function transport(options={}) {
  const calls=[],envSnapshot={}
  return {calls,envSnapshot,spawn(_file,args,settings){
    assert.ok(!args.join(' ').includes(TOKEN));Object.assign(envSnapshot,settings.env)
    const child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough()
    const end=()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('exit',0);child.emit('close',0)}
    child.kill=end
    child.stdin=new Writable({write(bytes,_encoding,done){
      const request=JSON.parse(bytes);calls.push(request)
      if(request.id)queueMicrotask(()=>{
        if(options.streamError){child[options.streamError].emit('error',new Error('Authorization '+TOKEN));return}
        if(options.stall)return
        let result={}
        if(request.method==='config/read')result={config:{mcp_servers:{[setup.serverName]:{url:setup.endpoint}}}}
        if(request.method==='thread/start')result={thread:{id:'mock-thread'}}
        if(request.method==='mcpServerStatus/list')result={data:[{name:setup.serverName,tools:Object.fromEntries(tools.slice(0,options.onlyFour?4:5).map(name=>[name,{name}]))}]}
        if(request.method==='mcpServer/tool/call')result={structuredContent:request.params.tool==='trackqa_connection_status'
          ?{project_id:PROJECT,database_connected:true,finding_submission:true,issue_writes_allowed:false}
          :{projects:[{id:options.crossProject?'22222222-2222-4222-8222-222222222222':PROJECT}]}}
        child.stdout.write(JSON.stringify({id:request.id,result})+'\n')
      })
      done()
    },final(done){queueMicrotask(end);done()}})
    return child
  }}
}
test('real-client protocol adapter discovers five tools but calls only the two read-only onboarding tools',async()=>{
  const mock=transport()
  const result=await verifyCodex('mock','mock-home',setup,TOKEN,undefined,mock.spawn,1000)
  assert.deepEqual(result,{authorized:true,verified:true,code:'verified'})
  assert.deepEqual(mock.calls.filter(call=>call.method==='mcpServer/tool/call').map(call=>call.params.tool),['trackqa_connection_status','trackqa_list_projects'])
  assert.equal(mock.calls.some(call=>call.method==='turn/start'),false)
  assert.equal(mock.envSnapshot[setup.envVar],TOKEN)
  assert.ok(!JSON.stringify(result).includes(TOKEN));assert.ok(!JSON.stringify(mock.calls).includes(TOKEN))
})
for(const option of ['onlyFour','crossProject','stall','stdout','stderr'])test('verification fails safely: '+option,async()=>{
  const mock=transport(option==='stdout'||option==='stderr'?{streamError:option}:{[option]:true})
  const result=await verifyCodex('mock','mock-home',setup,TOKEN,undefined,mock.spawn,60)
  assert.equal(result.verified,false);assert.ok(!JSON.stringify(result).includes(TOKEN))
  assert.equal(mock.calls.some(call=>call.params?.tool==='trackqa_submit_finding'),false)
})
test('foreground launch receives the credential only in the child environment and abort stops its own process',async()=>{
  const stop=new AbortController(),snapshot={};let killed=0
  const spawn=(_file,args,settings)=>{
    assert.deepEqual(args,[]);Object.assign(snapshot,settings.env)
    const child=new EventEmitter();child.kill=()=>{killed++;queueMicrotask(()=>child.emit('exit',null))}
    queueMicrotask(()=>stop.abort());return child
  }
  await assert.rejects(foreground('mock',{[setup.envVar]:TOKEN},stop.signal,spawn),error=>error.code==='interrupted')
  assert.equal(killed,1);assert.equal(snapshot[setup.envVar],TOKEN)
})
test('foreground forwards verified launch flags without credentials in arguments and retains inherited TTY handling',async()=>{
  const args=['--no-daemon'],snapshot={}
  const spawn=(_file,received,settings)=>{
    assert.deepEqual(received,['--no-daemon']);assert.notEqual(received,args)
    assert.equal(settings.stdio,'inherit');assert.ok(!received.join(' ').includes(TOKEN))
    Object.assign(snapshot,settings.env)
    const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child
  }
  await foreground('mock',{[setup.envVar]:TOKEN},undefined,spawn,args)
  assert.equal(snapshot[setup.envVar],TOKEN)
  assert.deepEqual(args,['--no-daemon'])
})
test('adapter selects only the verified launch mode, never auto-retries, and clears its credential environment',async t=>{
  const home=await temporary(t),file=path.join(home,'mock.exe');await writeFile(file,'mock executable')
  const sha256=createHash('sha256').update(await readFile(file)).digest('hex')
  let starts=0,retainedEnv
  for(const foregroundMode of ['no-daemon','direct','unsupported']){
    const adapter=codexAdapter({path:file,sha256,version:'mock',appServer:true,foregroundMode},home,undefined,{},async(exe,env,_signal,_spawn,args)=>{
      starts++;retainedEnv=env
      assert.equal(exe,file);assert.equal(env[setup.envVar],TOKEN)
      assert.deepEqual(args,foregroundMode==='no-daemon'?['--no-daemon']:[])
      assert.ok(!args.join(' ').includes(TOKEN))
    })
    if(foregroundMode==='unsupported')await assert.rejects(adapter.launch(setup,TOKEN),error=>error.code==='client_foreground_unsupported')
    else {await adapter.launch(setup,TOKEN);assert.equal(retainedEnv[setup.envVar],undefined)}
  }
  assert.equal(starts,2)
  const failed=codexAdapter({path:file,sha256,version:'mock',appServer:true,foregroundMode:'no-daemon'},home,undefined,{},async(_exe,env)=>{
    starts++;retainedEnv=env;throw new Error('Synthetic launch failure')
  })
  await assert.rejects(failed.launch(setup,TOKEN),/Synthetic launch failure/)
  assert.equal(starts,3);assert.equal(retainedEnv[setup.envVar],undefined)
})

test('installed Codex native commands work only in an isolated home; add/remove do not contact even the loopback fixture',{
  skip:!process.env.TRACKQA_NATIVE_CODEX,
},async t=>{
  const home=await temporary(t),env={...process.env,CODEX_HOME:home}
  const exe=await detectCodex(home,process.env.TRACKQA_NATIVE_CODEX,env)
  // No real endpoint, token or user config is used by this optional local check.
  let requests=0
  const server=createServer((_req,res)=>{requests++;res.writeHead(401);res.end()})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  const local={...setup,endpoint:`http://127.0.0.1:${server.address().port}/mcp`}
  const adapter=codexAdapter(exe,home,capture,{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,TEMP:home,TMP:home})
  const cleanEnv={CODEX_HOME:home,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:home,TMP:home}
  await capture(exe.path,['mcp','add','unrelated','--url',local.endpoint,'--bearer-token-env-var','UNRELATED_TOKEN'],cleanEnv)
  const before=await capture(exe.path,['mcp','get','unrelated','--json'],cleanEnv)
  const hash=await adapter.install(local)
  assert.ok(hash)
  await assert.rejects(adapter.install(local),error=>error.code==='configuration_conflict')
  await adapter.remove(local,hash)
  assert.equal(await capture(exe.path,['mcp','get','unrelated','--json'],cleanEnv),before)
  assert.equal(requests,0)
  const config=await readFile(path.join(home,'config.toml'),'utf8')
  assert.ok(!config.includes(TOKEN));assert.ok(!config.includes(setup.serverName))
  console.log('Installed native Codex checked:',exe.version,'; automated verifier capability:',exe.appServer,'; foreground mode:',exe.foregroundMode)
})

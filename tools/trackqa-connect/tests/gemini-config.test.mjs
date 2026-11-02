import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import path from 'node:path'
import os from 'node:os'
import { editGeminiSettings, readGeminiSettings, parseGeminiSettings, geminiEntry } from '../src/clients/gemini-config.ts'
import { commitWindowsSettings } from '../src/clients/gemini-windows.ts'
import { setupFor } from '../src/core.ts'
import { capture } from '../src/process.ts'

const setup=setupFor('11111111-1111-4111-8111-111111111111','gemini')
async function fixture(t,missing=false){
  const home=await mkdtemp(path.join(os.tmpdir(),'trackqa-gemini-config-'))
  t.after(async()=>{assert.ok(home.startsWith(path.join(os.tmpdir(),'trackqa-gemini-config-')));await rm(home,{recursive:true,force:true})})
  const dir=path.join(home,'.gemini'),file=path.join(dir,'settings.json')
  const original={general:{enableAutoUpdate:false},ui:{theme:'Default'},custom:{literal:'${HOME}',list:['$UNCHANGED',false,12]},
    mcpServers:{unrelated:{httpUrl:'https://example.invalid/mcp',headers:{Authorization:'Bearer ${UNRELATED_TOKEN}'},env:{NO_EXPANSION:'${PATH}'}}}}
  if(!missing){await mkdir(dir);await writeFile(file,JSON.stringify(original))}
  return {home,dir,file,original}
}
const metadata=async file=>{
  const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')
  return capture(shell,['-NoProfile','-NonInteractive','-Command',"$a=[IO.File]::GetAccessControl($env:TRACKQA_TEST_FILE); [Console]::Write(($a.AreAccessRulesProtected.ToString()+':'+$a.Sddl))"],{SystemRoot:process.env.SystemRoot,TRACKQA_TEST_FILE:file})
}
const inject=transform=>(file,expected,bytes)=>commitWindowsSettings(file,expected,bytes,(executable,args,options)=>{
  const changed=[...args];changed[changed.length-1]=transform(changed.at(-1));return spawn(executable,changed,options)
})
test('install/remove change only the owned entry and never expand unrelated references',async t=>{
  const previous=process.env.UNRELATED_TOKEN;process.env.UNRELATED_TOKEN='synthetic-not-a-credential'
  t.after(()=>{if(previous===undefined)delete process.env.UNRELATED_TOKEN;else process.env.UNRELATED_TOKEN=previous})
  const f=await fixture(t),beforeAcl=await metadata(f.file)
  const hash=await editGeminiSettings(f.home,setup,'install')
  const after=await readGeminiSettings(f.home)
  assert.deepEqual(after.mcpServers[setup.serverName],geminiEntry(setup))
  delete after.mcpServers[setup.serverName];assert.deepEqual(after,f.original)
  assert.equal(await metadata(f.file),beforeAcl,'existing Windows DACL is preserved')
  await editGeminiSettings(f.home,setup,'remove',hash)
  assert.deepEqual(await readGeminiSettings(f.home),f.original)
  assert.equal(await metadata(f.file),beforeAcl)
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('missing settings file/directory is created privately; unrelated files are never created',async t=>{
  const f=await fixture(t,true),hash=await editGeminiSettings(f.home,setup,'install')
  const acl=await metadata(f.file);assert.ok(acl.startsWith('True:'))
  await editGeminiSettings(f.home,setup,'remove',hash)
  assert.equal((await metadata(f.file)).replace('D:PAI(','D:P('),acl.replace('D:PAI(','D:P('),'protected DACL trustees/rights/owner/group remain unchanged')
  assert.deepEqual(await readGeminiSettings(f.home),{mcpServers:{}})
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('remove on a missing settings file is a no-op',async t=>{
  const f=await fixture(t,true)
  assert.equal(await editGeminiSettings(f.home,setup,'remove',null),null)
  assert.deepEqual(await readdir(f.home),[])
})
test('conflicting and edited entries require proven ownership and are preserved',async t=>{
  const f=await fixture(t),hash=await editGeminiSettings(f.home,setup,'install')
  await assert.rejects(editGeminiSettings(f.home,setup,'install'),e=>e.code==='configuration_conflict')
  await assert.rejects(editGeminiSettings(f.home,setup,'remove',null),e=>e.code==='configuration_changed')
  const data=await readGeminiSettings(f.home);data.mcpServers[setup.serverName].description='user-edited'
  const bytes=JSON.stringify(data);await writeFile(f.file,bytes)
  await assert.rejects(editGeminiSettings(f.home,setup,'remove',hash),e=>e.code==='configuration_changed')
  assert.equal(await readFile(f.file,'utf8'),bytes)
})
for(const [label,bytes] of [
  ['malformed','{'],['JSONC','{/*comment*/"ui":{}}'],['trailing comma','{"ui":{},}'],['root array','[]'],
  ['invalid server map','{"mcpServers":null}'],['invalid server','{"mcpServers":{"other":"invalid"}}'],
  ['duplicate key','{"ui":{"theme":"a","theme":"b"}}'],['escaped duplicate key','{"ui":{"theme":"a","th\\u0065me":"b"}}'],
  ['unsafe integer','{"custom":9007199254740993}'],['nonfinite number','{"custom":1e9999}'],
  ['UTF-8 BOM',Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d])],['invalid UTF-8',Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d])],
])test('unsupported settings are refused without writes: '+label,async t=>{
  const f=await fixture(t);await writeFile(f.file,bytes)
  await assert.rejects(editGeminiSettings(f.home,setup,'install'),e=>e.code==='configuration_unreadable')
  assert.deepEqual(await readFile(f.file),Buffer.from(bytes))
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('JSON size and nesting are bounded; nested arrays and escaped strings retain their values',()=>{
  assert.throws(()=>parseGeminiSettings(Buffer.from('{"x":'+'['.repeat(70)+'0'+']'.repeat(70)+'}')))
  assert.throws(()=>parseGeminiSettings(Buffer.alloc(1_048_577)))
  assert.deepEqual(parseGeminiSettings(Buffer.from('{"x":[{},[],["quote\\\"","\\u0061"]]}')),{x:[{},[],['quote"','a']]})
})
test('concurrent content modification before the platform writer is refused and external bytes survive',async t=>{
  const f=await fixture(t),external=JSON.stringify({...f.original,ui:{theme:'external'}})
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,async(...args)=>{
    await writeFile(f.file,external);await commitWindowsSettings(...args)
  }),e=>e.code==='configuration_changed')
  assert.equal(await readFile(f.file,'utf8'),external)
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('late concurrent modification is detected immediately before replacement',async t=>{
  const f=await fixture(t)
  const commit=inject(script=>script.replace('  Check-Original\n  # Commit point',"  [IO.File]::WriteAllText($file, '{\"ui\":{\"theme\":\"external\"}}')\n  Check-Original\n  # Commit point"))
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_changed')
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{ui:{theme:'external'}})
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('a competing writer lock is never removed by the failed operation',async t=>{
  const f=await fixture(t),bytes=await readFile(f.file)
  await writeFile(path.join(f.dir,'.trackqa-settings.lock'),'synthetic-owner')
  await assert.rejects(editGeminiSettings(f.home,setup,'install'),e=>e.code==='configuration_busy')
  assert.deepEqual(await readFile(f.file),bytes)
  assert.equal(await readFile(path.join(f.dir,'.trackqa-settings.lock'),'utf8'),'synthetic-owner')
})
for(const phase of ['flush','replacement'])test('failed '+phase+' leaves original bytes intact and cleans private temporary files',async t=>{
  const f=await fixture(t),bytes=await readFile(f.file)
  const commit=inject(script=>phase==='flush'?script.replace('$stream.Flush($true)',"throw 'injected-flush-failure'")
    :script.replace('  # Commit point',"  throw 'injected-replacement-failure'\n  # Commit point"))
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_write_failed')
  assert.deepEqual(await readFile(f.file),bytes)
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('replacement failure with an absent destination restores the original using a no-clobber move',async t=>{
  const f=await fixture(t),bytes=await readFile(f.file),acl=await metadata(f.file)
  const commit=inject(script=>script.replace('[IO.File]::Replace($temp, $file, $backup, $false)',"[IO.File]::Move($file, $backup); throw 'injected-partial-replace'"))
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_write_failed')
  assert.deepEqual(await readFile(f.file),bytes);assert.equal(await metadata(f.file),acl)
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})
test('an external edit after replacement is not overwritten by rollback; a recovery backup is retained',async t=>{
  const f=await fixture(t),bytes=await readFile(f.file)
  const commit=inject(script=>script.replace('[IO.File]::Replace($temp, $file, $backup, $false)',"[IO.File]::Replace($temp, $file, $backup, $false); [IO.File]::WriteAllText($file, '{\"ui\":{\"theme\":\"external\"}}')"))
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_write_uncertain')
  assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{ui:{theme:'external'}})
  const backup=(await readdir(f.dir)).find(file=>file.endsWith('.bak'))
  assert.ok(backup);assert.deepEqual(await readFile(path.join(f.dir,backup)),bytes)
})
test('the unavoidable final rename race is detected through the backup preimage and is never called CAS',async t=>{
  const f=await fixture(t)
  const commit=inject(script=>script.replace('[IO.File]::Replace($temp, $file, $backup, $false)',"[IO.File]::WriteAllText($file, '{\"ui\":{\"theme\":\"external\"}}'); [IO.File]::Replace($temp, $file, $backup, $false)"))
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_write_uncertain')
  const backup=(await readdir(f.dir)).find(file=>file.endsWith('.bak'))
  assert.ok(backup);assert.deepEqual(JSON.parse(await readFile(path.join(f.dir,backup),'utf8')),{ui:{theme:'external'}})
})
test('timeout/interruption has an unknown outcome, no retry, and does not expose settings in arguments',async t=>{
  const f=await fixture(t),bytes=await readFile(f.file);let killed=0,spawned=0
  const commit=(...args)=>commitWindowsSettings(...args,(_file,argv,options)=>{
    spawned++;assert.ok(!argv.join(' ').includes('${UNRELATED_TOKEN}'));assert.equal(options.stdio[0],'pipe')
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough()
    child.kill=()=>{killed++};return child
  },20)
  await assert.rejects(editGeminiSettings(f.home,setup,'install',null,commit),e=>e.code==='configuration_write_uncertain')
  assert.equal(spawned,1);assert.equal(killed,1);assert.deepEqual(await readFile(f.file),bytes)
})
test('no raw bearer is accepted as the new header or written to artifacts',async t=>{
  const f=await fixture(t),token='tqm_'+'a'.repeat(64)
  const hash=await editGeminiSettings(f.home,setup,'install')
  const bytes=await readFile(f.file,'utf8')
  assert.ok(bytes.includes('${'+setup.envVar+'}'));assert.ok(!bytes.includes(token))
  await editGeminiSettings(f.home,setup,'remove',hash)
  assert.deepEqual(await readdir(f.dir),['settings.json'])
})

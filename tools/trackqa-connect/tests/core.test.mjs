import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs, setupFor, display, boundedJson, ConnectorError } from '../src/core.ts'
import { safeCode } from '../src/cli.ts'
import { isPublicKey, publicKey } from '../src/auth.ts'
import { Store } from '../src/state.ts'
import { trustedLocation, detectCodex } from '../src/clients/codex.ts'
import { clientEnvironment } from '../src/process.ts'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
export async function temporary(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'trackqa-connect-test-'))
  t.after(async () => {
    assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep + 'trackqa-connect-test-'))
    await rm(base, { recursive: true, force: true })
  })
  return base
}
test('commands are explicit and no client is chosen by default', () => {
  assert.deepEqual(parseArgs([]), { command: 'help' })
  assert.deepEqual(parseArgs(['connect']), { command: 'connect' })
  assert.deepEqual(parseArgs(['status', '--client', 'codex', '--project', PROJECT]), { command: 'status', client: 'codex', projectId: PROJECT })
  assert.equal(parseArgs(['disconnect', '--client', 'codex']).command, 'disconnect')
})
for (const args of [['connect','--client','claude'],['connect','--token','never'],['connect','--client','codex','--client','codex'],['connect','--project','bad'],['unknown'],['status','--codex-path']]) {
  test('invalid/credential/unsupported arguments fail closed: ' + args.slice(0,2).join(' '), () => assert.throws(() => parseArgs(args)))
}
test('preview identifiers are project scoped and terminal labels cannot inject controls', () => {
  const setup = setupFor(PROJECT)
  assert.equal(setup.endpoint, 'https://mzeuimqfrswrwoaqjdmp.supabase.co/functions/v1/trackqa-mcp')
  assert.match(setup.envVar, /^TRACKQA_MCP_[0-9A-F]{32}_TOKEN$/)
  assert.equal(display('\x1b[31mName\r\n\x07'), 'Name')
  assert.equal(safeCode(new Error('Authorization: secret')), 'operation_failed')
})
test('public configuration rejects privileged keys', async () => {
  const jwt = body => 'e30.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.synthetic'
  assert.equal(isPublicKey(jwt({ role: 'service_role' })), false)
  assert.equal(isPublicKey(jwt({ role: 'anon' })), true)
  assert.equal(await publicKey({ TRACKQA_PUBLIC_KEY: 'sb_publishable_synthetic' }), 'sb_publishable_synthetic')
  await assert.rejects(publicKey({ TRACKQA_PUBLIC_KEY: 'sb_secret_synthetic' }))
})
test('only trusted native installation locations pass resolution; repository, relative, temporary and shims do not', () => {
  const home = 'C:\\Users\\owner', cwd = home + '\\work\\trackqa'
  const check = file => trustedLocation(file, home, 'win32', cwd)
  assert.equal(check(home+'\\.antigravity-ide\\extensions\\openai.chatgpt-1.0\\bin\\windows-x86_64\\codex.exe'), true)
  assert.equal(check('C:\\Program Files\\Codex\\codex.exe'), true)
  for (const candidate of [cwd+'\\codex.exe', home+'\\Downloads\\codex.exe', home+'\\AppData\\Local\\Temp\\codex.exe', '.\\codex.exe', 'C:\\Program Files\\Codex\\codex.cmd', home+'\\.antigravity-ide\\extensions\\evil.extension\\bin\\codex.exe']) assert.equal(check(candidate), false)
})
test('missing client and unsupported capabilities are reported without executing arbitrary paths', async t => {
  await assert.rejects(detectCodex(os.tmpdir(), undefined, { PATH: '' }), /did not complete/)
  const root = await temporary(t), file = path.join(root, 'mock-native')
  await writeFile(file, 'synthetic executable')
  const identity = { path: file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }
  const inspect = async () => identity
  await assert.rejects(detectCodex(root, file, {}, async () => 'not-codex', inspect), error => error.code === 'client_unsupported')
  await assert.rejects(detectCodex(root, file, {}, async (_file,args) => args[0] === '--version' ? 'codex-cli 0.1.0' : 'old help', inspect), error => error.code === 'client_unsupported')
  const result = await detectCodex(root, file, {}, async (_file,args) => args[0] === '--version' ? 'codex-cli 0.164.0-alpha.11.1' : 'app-server NAME --url --json --bearer-token-env-var', inspect)
  assert.equal(result.appServer, true)
  assert.equal(result.version, '0.164.0-alpha.11.1')
  assert.equal(result.foregroundMode, 'direct')
})
test('foreground flag is used only when advertised and accepted; MCP-only bundles remain inspectable but cannot launch',async t=>{
  const root=await temporary(t)
  const folder=path.join(root,'.vscode','extensions','openai.chatgpt-test','bin','windows-x86_64')
  await mkdir(folder,{recursive:true})
  const file=path.join(folder,'codex.exe');await writeFile(file,'mock native bundle')
  const inspect=async()=>({path:file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})
  const calls=[]
  const help=(flags='')=>async(_file,args)=>{
    calls.push(args)
    return args[0]==='--version'?'codex-cli 0.164.0-alpha.11.1':'app-server NAME --url --json --bearer-token-env-var '+flags
  }
  const unsupported=await detectCodex(root,file,{},help(),inspect)
  assert.equal(unsupported.foregroundMode,'unsupported')
  assert.equal(calls.some(args=>args[0]==='--no-daemon'),false)
  const supported=await detectCodex(root,file,{},help('--no-daemon'),inspect)
  assert.equal(supported.foregroundMode,'no-daemon')
  assert.ok(calls.some(args=>args.join(' ')==='--no-daemon --help'))
  const rejected=await detectCodex(root,file,{},async(...args)=>{
    if(args[1][0]==='--no-daemon')throw new Error('Unsupported flag')
    return help('--no-daemon')(...args)
  },inspect)
  assert.equal(rejected.foregroundMode,'unsupported')
  assert.equal(safeCode(new ConnectorError('client_foreground_unsupported')),'client_foreground_unsupported')
})
test('native standalone candidates take priority over bundled PATH entries; explicit selection is respected',async t=>{
  const root=await temporary(t),standalone=path.join(root,'standalone'),bundle=path.join(root,'.vscode','extensions','openai.chatgpt-test','bin','windows-x86_64')
  await mkdir(standalone,{recursive:true});await mkdir(bundle,{recursive:true})
  const filename=process.platform==='win32'?'codex.exe':'codex'
  for(const dir of [standalone,bundle])await writeFile(path.join(dir,filename),'mock executable')
  const checked=[]
  const inspect=async file=>{
    checked.push(file)
    assert.ok([standalone,bundle].includes(path.dirname(file)))
    return {path:file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')}
  }
  const run=async(_file,args)=>args[0]==='--version'?'codex-cli 0.164.0-alpha.11.1':'app-server NAME --url --json --bearer-token-env-var --no-daemon'
  const selected=await detectCodex(root,undefined,{PATH:[bundle,standalone].join(path.delimiter)},run,inspect)
  assert.equal(selected.path,path.join(standalone,filename))
  assert.equal(checked.some(file=>path.dirname(file)===bundle),false)
  const explicit=await detectCodex(root,path.join(bundle,filename),{PATH:standalone},run,inspect)
  assert.equal(explicit.path,path.join(bundle,filename))
  assert.equal(explicit.foregroundMode,'no-daemon')
})
test('child environments exclude database, human Auth and ambient MCP credentials', () => {
  const env = clientEnvironment('safe-home', { PATH: 'safe-path', SUPABASE_DB_PASSWORD: 'synthetic-secret', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret', TRACKQA_MCP_TOKEN: 'synthetic-secret' })
  assert.equal(env.PATH, 'safe-path')
  assert.ok(!JSON.stringify(env).includes('synthetic-secret'))
})
test('JSON transport bounds errors and oversized responses', async () => {
  await assert.rejects(boundedJson(Response.json({ message: 'private' }, { status: 500 })))
  await assert.rejects(boundedJson(Response.json({ text: 'x'.repeat(100) }), 10), error => error.code === 'response_limit')
  await assert.rejects(boundedJson(new Response('not json')), error => error.code === 'response_invalid')
})
test('PostgREST void RPCs accept successful empty bodies without pretending failed responses succeeded', async () => {
  assert.equal(await boundedJson(new Response('',{status:200})),null)
  assert.equal(await boundedJson(new Response(null,{status:204})),null)
  await assert.rejects(boundedJson(new Response('',{status:500})),error=>error.code==='request_failed')
})
test('recovery stores only validated metadata, writes atomically and rejects concurrent sessions', async t => {
  const store = new Store(await temporary(t))
  const record = { projectId: PROJECT, userId: USER, client: 'codex', executable: path.join(store.root,'mock-exe'), codexHome: path.join(store.root,'codex-home'), clientLabel: 'TrackQA Connect 33333333-3333-4333-8333-333333333333', connectionId: null, phase: 'installed', installed: true, lastVerifiedAt: null, configHash: 'a'.repeat(64) }
  const unlock = await store.lock()
  await assert.rejects(store.lock(), /connector_busy_or_stale_lock/)
  await store.save(record)
  assert.deepEqual(await store.read(), [record])
  await assert.rejects(store.save({ ...record, access_token: 'synthetic-secret' }))
  const raw = await readFile(path.join(store.root,'connections.json'),'utf8')
  assert.ok(!raw.includes('synthetic-secret'))
  await store.remove(PROJECT)
  assert.deepEqual(await store.read(), [])
  await unlock()
  const unlockAgain = await store.lock(); await unlockAgain()
})

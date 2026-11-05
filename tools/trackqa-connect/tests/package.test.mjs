import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageRoot, runtimeClosure } from '../scripts/build.mjs'

const manifest=JSON.parse(await readFile(path.join(packageRoot,'package.json'),'utf8'))
const output=path.join(packageRoot,'dist'),entry=path.join(packageRoot,manifest.bin.trackqa)
async function temporary(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'trackqa-package-test-'))
  t.after(async()=>{
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()))
    assert.match(path.basename(root),/^trackqa-package-test-[A-Za-z0-9]{6}$/)
    await rm(root,{recursive:true,force:true})
  })
  return root
}

test('publishable trackqa candidate preserves its identity and executable without the private flag',()=>{
  assert.equal(manifest.name,'trackqa');assert.equal(manifest.version,'0.1.3');assert.equal(Object.hasOwn(manifest,'private'),false)
  assert.deepEqual(manifest.bin,{trackqa:'dist/tools/trackqa-connect/src/cli.js'})
  assert.deepEqual(manifest.dependencies,{'@supabase/supabase-js':'2.113.0'})
  assert.equal(manifest.engines.node,'>=22.19.0')
  assert.equal(Object.keys(manifest.scripts).some(s=>['install','postinstall','preinstall','prepare'].includes(s)),false)
})

test('distribution allowlist exactly matches the compiled runtime closure and existing shared helpers',async()=>{
  const files=runtimeClosure(output,entry,manifest.dependencies).map(f=>path.relative(packageRoot,f).split(path.sep).join('/')).sort()
  assert.deepEqual(files,manifest.files.filter(f=>f.startsWith('dist/')).sort())
  assert.ok(files.includes('dist/tools/mcp-pilot/google-pkce.mjs'))
  assert.ok(files.includes('dist/src/lib/mcpOnboarding.js'))
  assert.ok(files.includes('dist/tools/trackqa-connect/src/testing/copilot-fixture-scope.js'),'Existing runtime capability guard must remain intact')
  for(const f of files)assert.doesNotMatch(f,/copilot-(?:hosted|synthetic|windows|process)|\.test\.|\/tests\/|\.env/)
  const actual=[]
  async function walk(p){for(const d of await readdir(p,{withFileTypes:true})){const f=path.join(p,d.name);assert.equal(d.isSymbolicLink(),false);if(d.isDirectory())await walk(f);else actual.push(path.relative(packageRoot,f).split(path.sep).join('/'))}}
  await walk(output);assert.deepEqual(actual.sort(),files)
  assert.match(await readFile(entry,'utf8'),/^#!\/usr\/bin\/env node\r?\n/)
})

test('built executable works outside the checkout without credentials and rejects token arguments before authentication',async t=>{
  const cwd=await temporary(t),env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,HOME:cwd,USERPROFILE:cwd,LOCALAPPDATA:cwd}
  const help=spawnSync(process.execPath,[entry,'--help'],{cwd,env,encoding:'utf8'})
  assert.equal(help.status,0);assert.match(help.stdout,/MVP-supported candidate/);assert.match(help.stdout,/ordinary connect remains guarded/)
  assert.doesNotMatch(help.stderr,/ERR_MODULE_NOT_FOUND/)
  const invalid=spawnSync(process.execPath,[entry,'connect','--token','synthetic-not-a-credential'],{cwd,env,encoding:'utf8'})
  assert.equal(invalid.status,1);assert.match(invalid.stdout,/stopped: usage/)
  assert.equal(invalid.stdout.includes('synthetic-not-a-credential'),false)
  assert.deepEqual(await readdir(cwd),[],'Help and validation must not create auth or recovery state')
})

test('packaged hosted configuration resolves in an empty environment without checkout configuration or network access', async () => {
  const { publicKey, OFFICIAL_PUBLIC_KEY } = await import(pathToFileURL(path.join(output, 'tools/trackqa-connect/src/auth.js')))
  const { SUPABASE_URL } = await import(pathToFileURL(path.join(output, 'tools/trackqa-connect/src/core.js')))
  assert.equal((await publicKey({})) === OFFICIAL_PUBLIC_KEY, true)
  const claims = JSON.parse(Buffer.from(OFFICIAL_PUBLIC_KEY.split('.')[1], 'base64url'))
  assert.equal(claims.role, 'anon')
  assert.equal(`https://${claims.ref}.supabase.co`, SUPABASE_URL)
  await assert.rejects(publicKey({ TRACKQA_PUBLIC_KEY: 'sb_secret_synthetic' }))
  const cli = await readFile(entry, 'utf8')
  assert.match(cli, /TrackQA Connect 0\.1\.3/)
  assert.match(cli, /no TRACKQA_PUBLIC_KEY setup is required/)
})

test('compiled normal and direct workflow paths preserve the Copilot production guard',async()=>{
  const {connect,connectCopilotFixture}=await import(pathToFileURL(path.join(output,'tools/trackqa-connect/src/workflow.js')))
  const forbidden=new Proxy({},{get(){assert.fail('No authentication, project access or launch is permitted')}})
  await assert.rejects(connect({adapter:{client:'vscode-copilot'},owner:forbidden,store:forbidden,ui:forbidden}),e=>e.code==='copilot_runtime_unverified')
  await assert.rejects(connectCopilotFixture({permit:{},adapter:{client:'vscode-copilot'},owner:forbidden,store:forbidden,ui:forbidden}),e=>e.code==='fixture_capability_invalid')
})

test('packaged location resolution accepts default profile and recovery roots from the user home without authentication', async t => {
  const home = await temporary(t)
  const data = process.platform === 'win32' ? path.join(home, 'AppData', 'Local') : path.join(home, '.local', 'state')
  await mkdir(path.join(home, '.codex'))
  await mkdir(data, { recursive: true })
  const module = pathToFileURL(entry).href
  const script = `const { locations } = await import(${JSON.stringify(module)}); const paths = await locations(process.env, 'codex'); console.log(JSON.stringify({ codexHome: paths.codexHome, recoveryRoot: paths.store.root }));`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: home, encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: home, USERPROFILE: home, LOCALAPPDATA: data, XDG_STATE_HOME: data },
  })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { codexHome: path.join(home, '.codex'), recoveryRoot: path.join(data, 'TrackQA-Connect') })
  const geminiScript = `const { locations } = await import(${JSON.stringify(module)}); const paths = await locations(process.env, 'gemini'); console.log(JSON.stringify({ geminiHome: paths.geminiHome, recoveryRoot: paths.store.root }));`
  const gemini = spawnSync(process.execPath, ['--input-type=module', '-e', geminiScript], {
    cwd: home, encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: home, USERPROFILE: home, LOCALAPPDATA: data, XDG_STATE_HOME: data },
  })
  assert.equal(gemini.status, 0)
  assert.deepEqual(JSON.parse(gemini.stdout), { geminiHome: home, recoveryRoot: path.join(data, 'TrackQA-Connect') })
  assert.deepEqual(await readdir(path.join(home, '.codex')), [])
  assert.deepEqual(await readdir(data), [], 'Path checks must not create locks, authentication or recovery state')
})

test('runtime closure refuses undeclared dependencies and imports outside the packaged tree without executing them',async t=>{
  const root=await temporary(t),file=path.join(root,'entry.js')
  await writeFile(file,"import 'undeclared-package';\nthrow new Error('must not execute');\n")
  assert.throws(()=>runtimeClosure(root,file,manifest.dependencies),/Undeclared runtime dependency/)
  await writeFile(file,"import '../outside.js';\n")
  assert.throws(()=>runtimeClosure(root,file,manifest.dependencies),/escapes the compiled output/)
})

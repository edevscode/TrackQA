import test from 'node:test'
import assert from 'node:assert/strict'
import { withOwner, publicKey, OFFICIAL_PUBLIC_KEY, isPublicKey } from '../src/auth.ts'
import { chooseProject } from '../src/workflow.ts'
import { SUPABASE_URL } from '../src/core.ts'
import { GOOGLE_REDIRECT } from '../../mcp-pilot/google-pkce.mjs'

const USER = '22222222-2222-4222-8222-222222222222'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const AUTH = 'synthetic-human-access-never-real', REFRESH = 'synthetic-refresh-never-real'
function fixture(options = {}) {
  const calls = [], session = { access_token: AUTH, refresh_token: REFRESH, provider_token: 'synthetic-provider' }
  const user = { id: USER, factors: options.mfa ? [{ status: 'verified' }] : [] }
  let settings, signedOut = 0
  const config = {
    key: 'sb_publishable_synthetic',
    makeClient(url, _key, supplied) {
      assert.equal(url, SUPABASE_URL); settings = supplied
      return { auth: {
        async getUser() { return { data: { user: options.wrongIdentity ? { id: PROJECT } : user } } },
        async signOut(args) { assert.deepEqual(args, { scope: 'local' }); signedOut++; return { error: options.logoutFailure ? new Error(AUTH) : null } },
      } }
    },
    async signIn() {
      settings.auth.storage.setItem('pkce', 'synthetic-verifier')
      if (options.loginFailure) return { error: new Error(AUTH), data: {} }
      return { data: { session, user } }
    },
    async fetch(input, init) {
      const url = new URL(input)
      assert.equal(url.origin, SUPABASE_URL)
      assert.equal(init.redirect, 'error')
      assert.equal(init.headers.Authorization, 'Bearer ' + AUTH)
      assert.equal(init.headers.apikey, config.key)
      calls.push({ path: url.pathname, method: init.method })
      assert.equal(init.method, 'GET')
      if (url.pathname.endsWith('/profiles')) return Response.json(options.noProfile ? [] : [{ id: USER }])
      const project = { id: PROJECT, name: 'Actual project selection', key: 'REAL', archived: !!options.archived, mcp_enabled: true }
      if (url.pathname.endsWith('/project_members')) {
        if (url.searchParams.has('project_id')) return Response.json([{ user_id: USER, role: options.removed ? 'DEVELOPER' : 'OWNER' }])
        return Response.json(options.noOwner ? [] : [{ project_id: PROJECT, role: 'OWNER', project }])
      }
      if (url.pathname.endsWith('/projects')) return Response.json([project])
      throw new Error('Unexpected request')
    },
  }
  return { config, calls, session, get signedOut() { return signedOut }, get settings() { return settings } }
}
const ui = { choose: async () => 0, say() {}, confirm: async () => true }
test('official hosted default is explicitly public and tied to the pinned deployment', async () => {
  const claims = JSON.parse(Buffer.from(OFFICIAL_PUBLIC_KEY.split('.')[1], 'base64url'))
  assert.equal(claims.role, 'anon')
  assert.equal(claims.iss, 'supabase')
  assert.equal(`https://${claims.ref}.supabase.co`, SUPABASE_URL)
  assert.ok(claims.exp > Date.now() / 1000)
  assert.equal(isPublicKey(OFFICIAL_PUBLIC_KEY), true)
  assert.equal((await publicKey({})) === OFFICIAL_PUBLIC_KEY, true)
  const f = fixture()
  f.config.key = await publicKey({})
  await withOwner(f.config, async owner => assert.equal(owner.userId, USER))
  assert.equal(f.signedOut, 1)
})

test('explicit environment overrides retain precedence and invalid values do not fall back', async () => {
  assert.equal(await publicKey({ TRACKQA_PUBLIC_KEY: 'sb_publishable_primary', VITE_SUPABASE_ANON_KEY: 'sb_publishable_secondary' }), 'sb_publishable_primary')
  assert.equal(await publicKey({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_secondary' }), 'sb_publishable_secondary')
  for (const value of ['', 'invalid', 'sb_secret_synthetic']) {
    await assert.rejects(publicKey({ TRACKQA_PUBLIC_KEY: value }), error => error.code === 'public_key_required')
  }
})

test('wrong-deployment anon keys fail before authorization; matching custom-build keys remain supported', async () => {
  const jwt = claims => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic'
  const key = jwt({ role: 'anon', ref: 'other-project' })
  await assert.rejects(publicKey({ TRACKQA_PUBLIC_KEY: key }), error => error.code === 'public_key_deployment_mismatch')
  await assert.rejects(publicKey({ VITE_SUPABASE_ANON_KEY: key }), error => error.code === 'public_key_deployment_mismatch')
  await assert.rejects(publicKey({}, 'https://other-project.supabase.co'))
  assert.equal(await publicKey({ TRACKQA_PUBLIC_KEY: key }, 'https://other-project.supabase.co'), key)
  const f = fixture()
  f.config.key = key
  await assert.rejects(withOwner(f.config, async () => assert.fail('Must not authorize')), error => error.code === 'public_key_deployment_mismatch')
  assert.equal(f.settings, undefined)
  assert.equal(f.calls.length, 0)
})

test('Google authentication is memory-only, verifies identity/profile, and selects a real Owner project without a pilot dependency', async () => {
  const f = fixture()
  const result = await withOwner(f.config, async owner => {
    assert.equal(Object.hasOwn(owner, 'access_token'), false)
    const project = await chooseProject(owner, ui)
    assert.equal(project.name, 'Actual project selection')
    return { userId: owner.userId, projectId: project.id }
  })
  assert.equal(result.projectId, PROJECT)
  assert.equal(f.settings.auth.flowType, 'pkce')
  assert.equal(f.settings.auth.persistSession, false)
  assert.equal(f.settings.auth.autoRefreshToken, false)
  assert.equal(f.settings.auth.debug, false)
  assert.equal(f.settings.auth.storage.getItem('pkce'), null)
  assert.equal(f.session.access_token, '')
  assert.equal(f.session.refresh_token, '')
  assert.equal(f.session.provider_token, null)
  assert.equal(f.signedOut, 1)
  assert.ok(!JSON.stringify(result).includes(AUTH))
})
for (const [option, code] of [['loginFailure','authentication_failed'], ['wrongIdentity','identity_unverified'], ['noProfile','profile_required'], ['mfa','mfa_unsupported'], ['noOwner','no_eligible_owner_projects'], ['archived','no_eligible_owner_projects'], ['removed','owner_required']]) {
  test('authorization boundary: ' + option, async () => {
    const f = fixture({ [option]: true })
    await assert.rejects(withOwner(f.config, owner => chooseProject(owner, ui)), error => {
      assert.equal(error.code, code)
      assert.ok(!error.message.includes(AUTH)); return true
    })
    assert.equal(f.settings.auth.storage.getItem('pkce'), null)
    assert.equal(f.calls.some(call => call.method !== 'GET'), false)
    assert.equal(f.signedOut, option === 'loginFailure' ? 0 : 1)
  })
}
test('project IDs cannot bypass the membership-scoped selection and logout failures are explicit', async () => {
  const f = fixture()
  await assert.rejects(withOwner(f.config, owner => chooseProject(owner, ui, USER)), error => error.code === 'project_unavailable')
  const failed = fixture({ logoutFailure: true })
  await assert.rejects(withOwner(failed.config, async () => 'safe result'), error => error.code === 'signout_unconfirmed')
})
test('human API closure refuses arbitrary targets, unsafe writes and privileged operations before fetching', async () => {
  const f = fixture()
  await withOwner(f.config, async owner => {
    const count = f.calls.length
    for (const [url, method, body] of [['https://evil.invalid/rest/v1/projects','GET'], ['/rest/v1/issues','POST',{}], ['/rest/v1/rpc/resolve_mcp_connection','POST',{}], ['/rest/v1/projects?id=eq.'+PROJECT,'PATCH',{mcp_enabled:false}]]) {
      await assert.rejects(owner.api(url,method,body))
    }
    assert.equal(f.calls.length,count)
  })
})
test('the actual Supabase SDK completes mocked PKCE exchange, generic Owner selection and local sign-out',async()=>{
  const jwt=body=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.c3ludGhldGlj'
  const access=jwt({sub:USER,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})
  const key=jwt({role:'anon'}),calls=[]
  const user={id:USER,aud:'authenticated',role:'authenticated',email:'owner@example.invalid',factors:[]}
  const result=await withOwner({key,
    async signIn(client){
      const start=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:GOOGLE_REDIRECT,skipBrowserRedirect:true}})
      assert.ok(start.data.flowId)
      assert.equal(new URL(start.data.url).origin,SUPABASE_URL)
      return client.auth.exchangeCodeForSession('synthetic-authorization-code',{flowId:start.data.flowId})
    },
    async fetch(input,init){
      const url=new URL(input);assert.equal(url.origin,SUPABASE_URL);assert.equal(init.redirect,'error')
      calls.push({path:url.pathname,query:url.search,method:init.method})
      if(url.pathname==='/auth/v1/token'){
        assert.equal(url.search,'?grant_type=pkce')
        const body=JSON.parse(init.body);assert.ok(body.code_verifier.length>10)
        return Response.json({access_token:access,refresh_token:REFRESH,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user})
      }
      assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+access)
      if(url.pathname==='/auth/v1/user')return Response.json(user)
      if(url.pathname==='/auth/v1/logout'){assert.equal(url.search,'?scope=local');return new Response(null,{status:204})}
      if(url.pathname.endsWith('/profiles'))return Response.json([{id:USER}])
      const project={id:PROJECT,name:'Non-pilot project',key:'APP',archived:false,mcp_enabled:true}
      if(url.pathname.endsWith('/project_members'))return Response.json(url.searchParams.has('project_id')?[{user_id:USER,role:'OWNER'}]:[{project_id:PROJECT,role:'OWNER',project}])
      if(url.pathname.endsWith('/projects'))return Response.json([project])
      throw new Error('Unexpected fetch')
    },
  },async owner=>({projectId:(await chooseProject(owner,ui)).id}))
  assert.deepEqual(result,{projectId:PROJECT})
  assert.equal(calls.filter(call=>call.path==='/auth/v1/token').length,1)
  assert.equal(calls.filter(call=>call.path==='/auth/v1/logout').length,1)
  assert.ok(!JSON.stringify(result).includes(access))
})

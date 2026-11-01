import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { checkCodexMcp, CODEX_TOOLS } from './codex-client.mjs'
import { AUTH_URL, FIXTURE_PROJECT_ID } from './owner-auth.mjs'

const TOKEN = 'tqm_' + 'a'.repeat(64)
const ISSUE = 'bf28539c-33c1-436a-a726-ada6843316ab'
function mock(discoveryError) {
  const calls = []
  return { calls, spawn(_executable, args, options) {
    assert.equal(args.join(' ').includes(TOKEN), false)
    assert.equal(args.join(' ').includes('required=true'), false, 'preserve detailed startup diagnostics through discovery')
    assert.equal(options.env.TRACKQA_MCP_TOKEN, TOKEN)
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null
    const end = () => { child.exitCode = 0; child.stdout.end(); child.stderr.end(); child.emit('exit', 0) }
    child.kill = end
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(chunk)
      calls.push(request)
      if (request.id) queueMicrotask(() => {
        let result = {}
        if (request.method === 'config/read') result = { config: { mcp_servers: { trackqaPilot: { url: AUTH_URL + '/functions/v1/trackqa-mcp' } } } }
        if (request.method === 'thread/start') { assert.equal(request.params.ephemeral, true); result = { thread: { id: 'ephemeral-test' } } }
        if (request.method === 'mcpServerStatus/list') result = { data: [{ name: 'trackqaPilot', toolsError: discoveryError,
          tools: Object.fromEntries(CODEX_TOOLS.map(name => [name, { name }])) }] }
        if (request.method === 'mcpServer/tool/call') {
          const name = request.params.tool
          const issue = { id: ISSUE, project_id: FIXTURE_PROJECT_ID, issue_number: 1, title: '[SYNTHETIC] MCP read-tool fixture' }
          const data = name === CODEX_TOOLS[0] ? { project_id: FIXTURE_PROJECT_ID, database_connected: true, read_only: true }
            : name === CODEX_TOOLS[1] ? { projects: [{ id: FIXTURE_PROJECT_ID, key: 'MCPPILOT' }] }
            : name === CODEX_TOOLS[2] ? { issues: [issue] } : { issue }
          result = { content: [], structuredContent: data }
        }
        child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n')
      })
      done()
    }, final(done) { queueMicrotask(end); done() } })
    return child
  } }
}

test('Codex native client calls only the four MCP tools sequentially without model turns or credentials in arguments/results', async () => {
  const transport = mock()
  const result = await checkCodexMcp({ executable: 'mock', token: TOKEN, cwd: '.', spawn: transport.spawn })
  assert.equal(result.ok, true)
  assert.equal(result.checks.length, 5)
  assert.deepEqual(transport.calls.filter(x => x.method === 'mcpServer/tool/call').map(x => x.params.tool), CODEX_TOOLS)
  assert.equal(transport.calls.some(x => x.method === 'turn/start'), false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(JSON.stringify(transport.calls).includes(TOKEN), false)
})

test('failed Codex initialization stops without tool calls and exposes only sanitized HTTP status', async () => {
  const transport = mock('HTTP status 401 Unauthorized: Authorization: Bearer ' + TOKEN)
  const result = await checkCodexMcp({ executable: 'mock', token: TOKEN, cwd: '.', spawn: transport.spawn })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'mcp_initialization_and_discovery')
  assert.equal(result.httpStatus, 401)
  assert.equal(transport.calls.some(x => x.method === 'mcpServer/tool/call'), false)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(JSON.stringify(result).includes('Authorization'), false)
})

test('invalid credentials are refused before a Codex process starts', async () => {
  let started = false
  const result = await checkCodexMcp({ token: 'invalid', spawn() { started = true } })
  assert.equal(result.ok, false)
  assert.equal(started, false)
})

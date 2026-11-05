import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

test('authorization loopback server handling', async t => {
  function startMockServer(expectedState) {
    return new Promise((resolve) => {
      let capturedResolve
      const promise = new Promise((res) => {
        capturedResolve = res
      })

      const server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1')
        if (parsedUrl.pathname !== '/callback') {
          res.writeHead(404)
          res.end('Not Found')
          return
        }

        const receivedState = parsedUrl.searchParams.get('state')
        const error = parsedUrl.searchParams.get('error')
        const token = parsedUrl.searchParams.get('token')
        const projectId = parsedUrl.searchParams.get('project_id')
        const projectName = parsedUrl.searchParams.get('project_name')
        const endpoint = parsedUrl.searchParams.get('endpoint')

        const SECURITY_HEADERS = {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, private, must-revalidate',
          'Pragma': 'no-cache',
          'Referrer-Policy': 'no-referrer',
        }

        if (receivedState !== expectedState) {
          res.writeHead(400, SECURITY_HEADERS)
          res.end('<h3>Invalid state parameter. Authorization rejected.</h3>')
          return
        }

        if (error === 'cancelled') {
          res.writeHead(200, SECURITY_HEADERS)
          res.end('<h3>Setup Cancelled</h3><script>window.history.replaceState({}, "", "/");</script>')
          server.close()
          capturedResolve({ cancelled: true })
          return
        }

        if (!token || !projectId || !endpoint) {
          res.writeHead(400, SECURITY_HEADERS)
          res.end('<h3>Incomplete authorization parameters.</h3>')
          return
        }

        res.writeHead(200, SECURITY_HEADERS)
        res.end('<h3>TrackQA Authorized!</h3><script>window.history.replaceState({}, "", "/");</script>')
        server.close()
        capturedResolve({
          cancelled: false,
          token,
          projectId,
          projectName: projectName || 'TrackQA Project',
          endpoint,
        })
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({ port: address.port, resultPromise: promise, server })
      })
    })
  }

  await t.test('accepts valid authorization callback', async () => {
    const state = 'test_state_12345'
    const { port, resultPromise } = await startMockServer(state)

    const url = `http://127.0.0.1:${port}/callback?state=${state}&token=tqm_test123&project_id=p-123&project_name=MyProject&endpoint=https://test.supabase.co/functions/v1/trackqa-mcp`
    const [data, res] = await Promise.all([
      resultPromise,
      fetch(url)
    ])
    assert.equal(res.status, 200)
    assert.match(res.headers.get('cache-control') || '', /no-store/)
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer')
    const bodyText = await res.text()
    assert.match(bodyText, /replaceState/)
    assert.equal(data.cancelled, false)
    assert.equal(data.token, 'tqm_test123')
    assert.equal(data.projectId, 'p-123')
    assert.equal(data.projectName, 'MyProject')
    assert.equal(data.endpoint, 'https://test.supabase.co/functions/v1/trackqa-mcp')
  })

  await t.test('rejects callback with state mismatch without terminating server, then accepts valid callback', async () => {
    const state = 'correct_state'
    const { port, resultPromise } = await startMockServer(state)

    // Send forged request
    const forgedUrl = `http://127.0.0.1:${port}/callback?state=wrong_state&token=tqm_123&project_id=p-1&endpoint=https://x`
    const forgedRes = await fetch(forgedUrl)
    assert.equal(forgedRes.status, 400)

    // Legitimate callback succeeds subsequently
    const validUrl = `http://127.0.0.1:${port}/callback?state=${state}&token=tqm_legit&project_id=p-1&endpoint=https://x`
    const [data, validRes] = await Promise.all([
      resultPromise,
      fetch(validUrl)
    ])
    assert.equal(validRes.status, 200)
    assert.equal(data.token, 'tqm_legit')
  })

  await t.test('handles user cancellation gracefully', async () => {
    const state = 'state_cancel'
    const { port, resultPromise } = await startMockServer(state)

    const url = `http://127.0.0.1:${port}/callback?state=${state}&error=cancelled`
    const [data, res] = await Promise.all([
      resultPromise,
      fetch(url)
    ])
    assert.equal(res.status, 200)
    assert.equal(data.cancelled, true)
  })
})

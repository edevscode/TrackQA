import http from 'node:http'
import crypto from 'node:crypto'
import { openBrowser } from './browser.js'
import { verifyMcpConnection } from './verify.js'

import * as antigravity from './clients/antigravity.js'
import * as vscode from './clients/vscode.js'
import * as claude from './clients/claude.js'
import * as windsurf from './clients/windsurf.js'
import * as codex from './clients/codex.js'

const CLIENTS = [antigravity, claude, vscode, windsurf, codex]

export async function runSetup(options = {}) {
  const appUrl = options.appUrl || process.env.TRACKQA_APP_URL || 'https://trackqa.vercel.app'
  const state = crypto.randomBytes(32).toString('hex')

  console.log('\n  ╭──────────────────────────────────────────────────────────╮')
  console.log('  │                 TrackQA AI Agent Setup                   │')
  console.log('  ╰──────────────────────────────────────────────────────────╯\n')

  // 1. Start loopback server
  const { port, resultPromise } = await new Promise((resolve, reject) => {
    let capturedResolve
    const promise = new Promise((res) => {
      capturedResolve = res
    })

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://127.0.0.1`)
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

      if (receivedState !== state) {
        res.writeHead(400, SECURITY_HEADERS)
        res.end('<h3>Invalid state parameter. Authorization rejected.</h3>')
        return
      }

      if (error === 'cancelled') {
        res.writeHead(200, SECURITY_HEADERS)
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="referrer" content="no-referrer" />
            </head>
            <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;">
              <div style="text-align:center;padding:32px;background:white;border-radius:12px;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1);max-width:400px;">
                <h2 style="color:#0f172a;margin-top:0;">Setup Cancelled</h2>
                <p style="color:#64748b;">You cancelled authorization. You can close this tab.</p>
              </div>
              <script>
                if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
                  window.history.replaceState({}, '', window.location.pathname);
                }
              </script>
            </body>
          </html>
        `)
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
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="referrer" content="no-referrer" />
          </head>
          <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;">
            <div style="text-align:center;padding:32px;background:white;border-radius:12px;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1);max-width:400px;">
              <div style="width:48px;height:48px;margin:0 auto 16px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <h2 style="color:#0f172a;margin-top:0;">TrackQA Authorized!</h2>
              <p style="color:#64748b;">Return to your terminal to see configuration results.</p>
            </div>
            <script>
              if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
                window.history.replaceState({}, '', window.location.pathname);
              }
            </script>
          </body>
        </html>
      `)

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
      resolve({ port: address.port, resultPromise: promise })
    })

    server.on('error', reject)
  })

  // 2. Open browser
  const projectQuery = options.project ? `&project=${encodeURIComponent(options.project)}` : ''
  const authUrl = `${appUrl}/authorize-agent?port=${port}&state=${state}${projectQuery}`

  console.log('  Opening your browser to authorize TrackQA...')
  console.log(`  Browser URL: ${authUrl}\n`)
  console.log('  Waiting for browser authorization... (Press Ctrl+C to cancel)\n')

  openBrowser(authUrl)

  // 3. Await callback with 120s timeout
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Authorization timed out after 120 seconds')), 120000)
    if (timeoutId.unref) timeoutId.unref()
  })

  let authData
  try {
    authData = await Promise.race([resultPromise, timeoutPromise])
  } catch (err) {
    console.error(`  [!] Error: ${err.message}\n`)
    process.exit(1)
  } finally {
    clearTimeout(timeoutId)
  }

  if (authData.cancelled) {
    console.log('  [-] Setup was cancelled in the browser.\n')
    process.exit(0)
  }

  const { token, projectId, projectName, endpoint } = authData
  console.log(`  ✓ Authorized for project: ${projectName} (${projectId})`)

  // 4. Test live MCP connectivity
  process.stdout.write('  → Verifying remote MCP endpoint connection... ')
  const verification = await verifyMcpConnection(endpoint, token)
  if (verification.ok) {
    console.log('OK (Live MCP ready)')
  } else {
    console.log(`Warning (${verification.error})`)
  }

  // 5. Discover and configure clients
  console.log('\n  Configuring AI Coding Assistants:')
  const results = []

  for (const client of CLIENTS) {
    try {
      if (!client.isInstalled()) {
        results.push({ name: client.name, status: 'skipped', message: 'Not detected' })
        continue
      }

      const res = await client.configure({ endpoint, token, projectId, projectName })
      if (res.ok) {
        results.push({ name: client.name, status: 'configured', path: res.targetPath })
      } else {
        results.push({ name: client.name, status: 'failed', message: res.error || 'Configuration failed' })
      }
    } catch (clientErr) {
      results.push({ name: client.name, status: 'failed', message: clientErr.message })
    }
  }

  for (const r of results) {
    if (r.status === 'configured') {
      console.log(`    [✓] ${r.name.padEnd(20)} -> Configured (${r.path})`)
    } else if (r.status === 'skipped') {
      console.log(`    [-] ${r.name.padEnd(20)} -> Skipped (${r.message})`)
    } else {
      console.log(`    [!] ${r.name.padEnd(20)} -> Failed (${r.message})`)
    }
  }

  console.log('\n  ✓ Setup complete! Your AI assistants can now interact with TrackQA.\n')
}


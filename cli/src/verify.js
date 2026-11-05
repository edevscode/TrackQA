/**
 * Verify remote TrackQA MCP connection status.
 */
export async function verifyMcpConnection(endpoint, token) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'verify-1',
        method: 'tools/call',
        params: {
          name: 'trackqa_connection_status',
          arguments: {},
        },
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from MCP endpoint` }
    }

    const contentType = response.headers.get('content-type') || ''
    const rawText = await response.text()
    let data

    if (contentType.includes('text/event-stream')) {
      const line = rawText.split('\n').find(l => l.startsWith('data: '))
      data = line ? JSON.parse(line.slice(6)) : {}
    } else {
      data = JSON.parse(rawText)
    }

    if (data.error) {
      return { ok: false, error: data.error.message || 'MCP error' }
    }

    const text = data.result?.content?.[0]?.text
    const status = text ? JSON.parse(text) : data.result?.structuredContent
    return { ok: true, status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

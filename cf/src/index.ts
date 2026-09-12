export interface Env {
  ASSETS: Fetcher
  CONFIG: KVNamespace
  BACKEND_URL: string
  ADMIN_KEY?: string   // wrangler secret put ADMIN_KEY
}

async function backendUrl(env: Env): Promise<string | null> {
  const kv = await env.CONFIG.get('backend_url')
  const url = (kv || env.BACKEND_URL || '').trim().replace(/\/$/, '')
  return url.startsWith('http') ? url : null
}

function withCors(res: Response): Response {
  const h = new Headers(res.headers)
  h.set('access-control-allow-origin', '*')
  return new Response(res.body, { status: res.status, headers: h })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // --- admin: read/set the laptop backend URL (host page or `npm run set-backend`) ---
    if (path === '/backend' || path === '/backend/set') {
      const key = request.headers.get('x-admin-key') ?? url.searchParams.get('key') ?? ''
      if (path === '/backend/set') {
        if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return new Response('forbidden', { status: 403 })
        const target = url.searchParams.get('url') ?? (await request.text())
        if (!/^https?:\/\//.test(target)) return new Response('bad url', { status: 400 })
        await env.CONFIG.put('backend_url', target.trim().replace(/\/$/, ''))
        return Response.json({ ok: true, backend_url: target })
      }
      const current = await backendUrl(env)
      return Response.json({ backend_url: current ? current.replace(/^https?:\/\/([^.]+)\..*$/, 'https://$1.…') : null, configured: !!current })
    }

    const proxied = path === '/ws' || path.startsWith('/api/') || path.startsWith('/audio/')
    if (proxied) {
      const base = await backendUrl(env)
      if (!base) return new Response('game server not configured: set the backend URL', { status: 503 })
      const target = new URL(base)
      target.pathname = path
      target.search = url.search

      // --- WebSocket: upgrade upstream and pipe both directions ---
      if (path === '/ws') {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 })
        const upstreamResp = await fetch(target.toString(), { headers: { upgrade: 'websocket', connection: 'Upgrade' } })
        const upstream = upstreamResp.webSocket
        if (!upstream) return new Response(`upstream refused websocket (${upstreamResp.status})`, { status: 502 })
        upstream.accept()
        const pair = new WebSocketPair()
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
        server.accept()
        const close = (a: WebSocket, b: WebSocket) => (ev: CloseEvent) => { try { b.close(ev.code, ev.reason) } catch { /* already closed */ } void a }
        server.addEventListener('message', (ev) => { try { upstream.send(ev.data) } catch { server.close(1011, 'upstream gone') } })
        upstream.addEventListener('message', (ev) => { try { server.send(ev.data) } catch { upstream.close(1011, 'client gone') } })
        server.addEventListener('close', close(server, upstream))
        upstream.addEventListener('close', close(upstream, server))
        server.addEventListener('error', () => upstream.close(1011, 'client error'))
        upstream.addEventListener('error', () => server.close(1011, 'upstream error'))
        return new Response(null, { status: 101, webSocket: client })
      }

      // --- plain HTTP proxy (api, audio cache) ---
      const init: RequestInit = { method: request.method, headers: request.headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }
      const res = await fetch(target.toString(), init)
      return withCors(res)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

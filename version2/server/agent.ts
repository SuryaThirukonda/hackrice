// Node agent service: keeps the OpenAI key server-side. HTTP + WebSocket on :8790.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import OpenAI from 'openai'
import { WebSocketServer } from 'ws'
import { AgentService, type ActRequest, type LlmClient } from './service'
import { ControllerRelay } from './controllerRelay'

function loadEnv(): void {
  for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch { /* no file */ }
  }
}
loadEnv()
const key = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || ''
const model = process.env.AGENT_MODEL || 'gpt-5.6-luna'
const port = Number(process.env.AGENT_PORT || 8790)
/** Narrow the SDK to the slice the service uses (keeps the service testable with a fake). */
function adapt(raw: OpenAI): LlmClient {
  return {
    models: { retrieve: (id) => raw.models.retrieve(id) },
    responses: { create: (params, opts) => raw.responses.create(params as unknown as Parameters<typeof raw.responses.create>[0], opts) as unknown as Promise<{ output: { type: string; name?: string; arguments?: string }[] }> },
  }
}
const client = key ? adapt(new OpenAI({ apiKey: key })) : null
const service = new AgentService({ client, model })

const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' })
  res.end(JSON.stringify(body))
}
const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (url.startsWith('/agent/health')) return json(res, 200, await service.health())
  if (url.startsWith('/agent/act') && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try { json(res, 200, await service.act(JSON.parse(body) as ActRequest)) } catch (e) { json(res, 400, { error: String((e as Error).message) }) }
    })
    return
  }
  json(res, 404, { error: 'not found' })
})
const wss = new WebSocketServer({ noServer: true })
const controllerRelay = new ControllerRelay()
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(String(data)) as { id: number; req: ActRequest }
      const out = await service.act(msg.req)
      ws.send(JSON.stringify({ id: msg.id, ...out }))
    } catch (e) { ws.send(JSON.stringify({ error: String((e as Error).message) })) }
  })
})
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/agent/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  } else if (controllerRelay.handles(pathname)) controllerRelay.upgrade(request, socket, head)
  else socket.destroy()
})
server.listen(port, () => {
  console.log(`[agent] listening on :${port} model=${model} key=${key ? 'present' : 'missing (fallback scripts only)'}`)
  void service.health().then((h) => console.log('[agent] health', JSON.stringify(h)))
})

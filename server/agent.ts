// Node agent service: keeps the OpenAI key server-side. HTTP + WebSocket on :8790.
import { createServer, type IncomingMessage } from 'node:http'
import { mkdirSync } from 'node:fs'
import { HealthStore } from './health'
import { VitalsBridge, listCameras } from './vitals'
import { START_CHIPS } from '../src/betting/book'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import OpenAI from 'openai'
import { WebSocketServer } from 'ws'
import { ControllerRelay } from './controllerRelay'
import { AgentService, type ActRequest, type LlmClient } from './service'

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
// Local movement history for the health tab. Lives beside the repo in data/, which is git-ignored.
mkdirSync('data', { recursive: true })
const health = new HealthStore('data/health.sqlite')
// Camera vitals. Off until the test page or the game turns it on; readings that pass the gate are kept locally.
const vitals = new VitalsBridge(() => process.env.PRESSAGE_KEY || process.env.PRESAGE_KEY || process.env.PRESAGE_API_KEY || '')
vitals.onReading = (r) => health.addVital(r)
const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve) => {
  let raw = ''
  req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); if (raw.length > 1_000_000) req.destroy() })
  req.on('end', () => { try { const v: unknown = JSON.parse(raw || '{}'); resolve(v && typeof v === 'object' ? v as Record<string, unknown> : {}) } catch { resolve({}) } })
  req.on('error', () => resolve({}))
})
const sportOf = (v: unknown): 'boxing' | 'bowling' | 'golf' | null => (v === 'boxing' || v === 'bowling' || v === 'golf' ? v : null)

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (url.startsWith('/vitals')) {
    const path = new URL(url, 'http://localhost').pathname
    const q = new URL(url, 'http://localhost').searchParams
    if (req.method === 'GET' && path === '/vitals') return json(res, 200, vitals.state)
    if (req.method === 'GET' && path === '/vitals/devices') return json(res, 200, listCameras())
    if (req.method === 'GET' && path === '/vitals/history') return json(res, 200, health.vitalsHistory(Date.now() - Math.max(1, Math.min(24 * 60, Number(q.get('minutes') ?? 30))) * 60_000))
    if (req.method === 'POST' && path === '/vitals/start') { const b = await readJson(req); return json(res, 200, await vitals.start({ cameraIndex: Number.isFinite(Number(b.cameraIndex)) ? Number(b.cameraIndex) : 0, demo: b.demo === true })) }
    if (req.method === 'POST' && path === '/vitals/stop') return json(res, 200, await vitals.stop())
    if (req.method === 'OPTIONS') return json(res, 204, {})
    return json(res, 404, { error: 'not_found' })
  }
  if (url.startsWith('/chips')) {
    const path = new URL(url, 'http://localhost').pathname
    const q = new URL(url, 'http://localhost').searchParams
    const m = /^\/chips\/fight\/(\d+)\/(bet|settle|finish)$/.exec(path)
    const n = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d)
    const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [])
    const ledgerOf = (v: unknown) => rows(v).slice(0, 500).map((e) => ({ at: n(e.at, Date.now()), reason: String(e.reason ?? 'grant').slice(0, 16), amount: n(e.amount), balance: n(e.balance) }))
    if (req.method === 'GET' && path === '/chips/summary') return json(res, 200, health.chipSummary(START_CHIPS))
    if (req.method === 'GET' && path === '/chips/ledger') return json(res, 200, health.chipLedger(Math.max(1, Math.min(2000, n(q.get('limit'), 200)))))
    if (req.method === 'POST' && path === '/chips/fight') {
      const b = await readJson(req)
      const id = health.startFight({ startedAt: n(b.startedAt, Date.now()), seed: n(b.seed), nameA: String(b.nameA ?? 'A').slice(0, 40), nameB: String(b.nameB ?? 'B').slice(0, 40), chipsBefore: n(b.chipsBefore, START_CHIPS) })
      return json(res, 200, { id, balance: health.chipBalance(START_CHIPS) })
    }
    if (req.method === 'POST' && m) {
      const id = Number(m[1]); const b = await readJson(req)
      if (m[2] === 'bet') return json(res, 200, { id: health.recordBet(id, { at: n(b.at, Date.now()), market: String(b.market ?? '').slice(0, 24), kind: String(b.kind ?? 'match').slice(0, 8), round: n(b.round), corner: String(b.corner ?? 'a').slice(0, 1), stake: n(b.stake), odds: n(b.odds, 1) }) })
      if (m[2] === 'settle') { health.settleMarket(id, String(b.market ?? '').slice(0, 24), String(b.winner ?? 'draw').slice(0, 4), rows(b.bets).map((x) => ({ corner: String(x.corner ?? 'a').slice(0, 1), stake: n(x.stake), paid: n(x.paid) })), ledgerOf(b.ledger)); return json(res, 200, { ok: true, balance: health.chipBalance(START_CHIPS) }) }
      health.appendLedger(id, ledgerOf(b.ledger))
      health.finishFight(id, { endedAt: n(b.endedAt, Date.now()), winner: String(b.winner ?? 'draw').slice(0, 4), by: String(b.by ?? '').slice(0, 12), round: n(b.round), chipsAfter: n(b.chipsAfter), betsWon: n(b.betsWon), betsLost: n(b.betsLost), net: n(b.net) })
      return json(res, 200, { ok: true, balance: health.chipBalance(START_CHIPS) })
    }
    if (req.method === 'DELETE' && path === '/chips') return json(res, 200, { balance: health.resetChips(START_CHIPS) })
    if (req.method === 'OPTIONS') return json(res, 204, {})
    return json(res, 404, { error: 'not_found' })
  }
  if (url.startsWith('/health')) {
    const path = new URL(url, 'http://localhost').pathname
    const q = new URL(url, 'http://localhost').searchParams
    const m = /^\/health\/session\/(\d+)\/(add|finish)$/.exec(path)
    if (req.method === 'GET' && path === '/health/summary') return json(res, 200, health.summary(Date.now(), Math.max(1, Math.min(90, Number(q.get('days') ?? 7)))))
    if (req.method === 'GET' && path === '/health/sessions') return json(res, 200, health.sessions(Math.max(1, Math.min(500, Number(q.get('limit') ?? 50)))))
    if (req.method === 'POST' && path === '/health/session') {
      const b = await readJson(req); const sport = sportOf(b.sport)
      if (!sport) return json(res, 400, { error: 'sport' })
      const weight = Number(b.weightKg); const started = Number(b.startedAt)
      const id = health.start({ sport, controller: String(b.controller ?? 'controller_1').slice(0, 32), startedAt: Number.isFinite(started) ? started : Date.now(), weightKg: Number.isFinite(weight) && weight > 0 ? weight : 70, source: b.source === 'phone' ? 'phone' : 'keyboard' })
      return json(res, 200, { id })
    }
    if (req.method === 'POST' && m) {
      const id = Number(m[1]); const b = await readJson(req)
      if (!health.row(id)) return json(res, 404, { error: 'session' })
      if (m[2] === 'add') {
        const epochs = (Array.isArray(b.epochs) ? b.epochs : []).slice(0, 3600).map((e) => { const r = e as Record<string, unknown>; return { t: Number(r.t) || 0, mean: Number(r.mean) || 0, peak: Number(r.peak) || 0, swings: Number(r.swings) || 0, rotation: Number(r.rotation) || 0 } })
        const roms = (Array.isArray(b.roms) ? b.roms : []).slice(0, 2000).map((r) => Number(r) || 0)
        health.add(id, epochs, roms)
        return json(res, 200, { ok: true })
      }
      const ended = Number(b.endedAt)
      return json(res, 200, health.finish(id, Number.isFinite(ended) ? ended : Date.now(), b.source === 'phone' ? 'phone' : b.source === 'keyboard' ? 'keyboard' : undefined))
    }
    if (req.method === 'DELETE' && path === '/health') { health.clear(); return json(res, 200, { ok: true }) }
    if (req.method === 'OPTIONS') return json(res, 204, {})
    return json(res, 404, { error: 'not_found' })
  }
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
// noServer + manual upgrade routing: the { server, path } form installs its own upgrade listener that
// rejects every other path with a 400, which would make the controller relay unreachable on this port.
const wss = new WebSocketServer({ noServer: true })
const relay = new ControllerRelay()
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname === '/agent/ws') wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request))
  else if (relay.handles(pathname)) relay.upgrade(request, socket, head)
  else socket.destroy()
})
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(String(data)) as { id: number; req: ActRequest }
      const out = await service.act(msg.req)
      ws.send(JSON.stringify({ id: msg.id, ...out }))
    } catch (e) { ws.send(JSON.stringify({ error: String((e as Error).message) })) }
  })
})
// A second copy of this service is the usual reason the port is taken (one left running in another
// terminal or in the background). Say so instead of dying with a stack trace.
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[agent] port ${port} is already in use: another agent service is running. Stop it, or start this one with AGENT_PORT=<other port>.`)
    process.exit(1)
  }
  throw error
})
server.listen(port, () => {
  console.log(`[agent] listening on :${port} model=${model} key=${key ? 'present' : 'missing (fallback scripts only)'}`)
  console.log('[controller] relay on /controller-ws (phones) and /controller-game-ws (game)')
  void service.health().then((h) => console.log('[agent] health', JSON.stringify(h)))
})

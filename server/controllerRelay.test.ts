import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { ControllerRelay } from './controllerRelay'

/**
 * End-to-end over real sockets: a phone on /controller-ws and the game on /controller-game-ws, through the
 * same HTTP server the agent service uses. These are the protocol guarantees the game relies on, so they are
 * asserted against the wire rather than against the class.
 */
let server: Server
let port = 0
const relay = new ControllerRelay()

beforeAll(async () => {
  server = createServer((_req, res) => { res.statusCode = 404; res.end() })
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (relay.handles(pathname)) relay.upgrade(request, socket, head)
    else socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : 0
})

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

/**
 * Every message a socket has received, buffered from the moment it is created, plus a read cursor.
 * Buffering is what makes the roster assertion possible at all: the relay sends the current controller
 * roster inside its own connection handler, which runs before a test can attach a listener. The cursor
 * keeps `next()` a stream reader rather than a search, so an old acknowledgement cannot answer a new call.
 */
interface Inbox { seen: Record<string, unknown>[]; read: number }
const inbox = new WeakMap<WebSocket, Inbox>()

const open = async (path: string): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  const box: Inbox = { seen: [], read: 0 }
  inbox.set(ws, box)
  ws.on('message', (raw) => { try { box.seen.push(JSON.parse(String(raw)) as Record<string, unknown>) } catch { /* ignore */ } })
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  return ws
}
/** Next unread message matching `want`, or null after `ms`. Non-matching traffic (pongs, status) is skipped. */
const next = (ws: WebSocket, want: (m: Record<string, unknown>) => boolean, ms = 700): Promise<Record<string, unknown> | null> => {
  const box = inbox.get(ws) ?? { seen: [], read: 0 }
  for (let i = box.read; i < box.seen.length; i++) {
    if (!want(box.seen[i])) continue
    box.read = i + 1
    return Promise.resolve(box.seen[i])
  }
  box.read = box.seen.length
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); resolve(null) }, ms)
    const onMessage = (raw: unknown): void => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(raw)) as Record<string, unknown> } catch { return }
      if (!want(m)) return
      box.read = box.seen.length
      clearTimeout(timer); ws.off('message', onMessage); resolve(m)
    }
    ws.on('message', onMessage)
  })
}

/** Close and WAIT. The relay is shared across tests, so a slot must be genuinely released before the next one. */
const shut = async (...sockets: WebSocket[]): Promise<void> => {
  await Promise.all(sockets.map((s) => s.readyState === WebSocket.CLOSED
    ? Promise.resolve()
    : new Promise<void>((resolve) => { s.once('close', () => resolve()); s.close() })))
}

const hello = async (ws: WebSocket, id: string, seq = 0): Promise<Record<string, unknown> | null> => {
  const ack = next(ws, (m) => m.type === 'hello' || m.type === 'error')
  ws.send(JSON.stringify({ v: 1, type: 'hello', controllerId: id, seq }))
  return ack
}

describe('controller relay over real sockets', () => {
  it('acknowledges a claim and tells the phone the current sport and guard', async () => {
    const game = await open('/controller-game-ws')
    game.send(JSON.stringify({ type: 'game_state', sport: 'boxing' }))
    await new Promise((r) => setTimeout(r, 50))
    const phone = await open('/controller-ws')
    const ack = await hello(phone, 'controller_1')
    expect(ack).toMatchObject({ type: 'hello', ok: true, controllerId: 'controller_1', sport: 'boxing', blocking: false })
    await shut(phone, game)
  })

  it('carries a punch from the phone to the game with the active sport stamped on', async () => {
    const game = await open('/controller-game-ws')
    game.send(JSON.stringify({ type: 'game_state', sport: 'boxing' }))
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    const delivered = next(game, (m) => m.type === 'gesture')
    phone.send(JSON.stringify({ v: 1, type: 'gesture', controllerId: 'controller_1', seq: 5, eventId: 'e2e-1', gesture: 'punch', power: 87, direction: [0, 0, -1], peakAcceleration: 31, peakRotation: 240, duration: 130 }))
    expect(await delivered).toMatchObject({ type: 'gesture', gesture: 'punch', power: 87, sport: 'boxing', controllerId: 'controller_1' })
    await shut(phone, game)
  })

  it('delivers a repeated eventId only once, and never rewinds the sequence', async () => {
    const game = await open('/controller-game-ws')
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_2')
    const seen: unknown[] = []
    game.on('message', (raw) => { const m = JSON.parse(String(raw)) as { type?: string }; if (m.type === 'action') seen.push(m) })
    const packet = { v: 1, type: 'action', controllerId: 'controller_2', seq: 9, eventId: 'dup-1', action: 'block_start', sport: 'boxing' }
    phone.send(JSON.stringify(packet))
    phone.send(JSON.stringify({ ...packet, seq: 10 })) // same eventId, fresh sequence
    phone.send(JSON.stringify({ ...packet, seq: 2, eventId: 'stale-1' })) // stale sequence
    await new Promise((r) => setTimeout(r, 250))
    expect(seen).toHaveLength(1)
    await shut(phone, game)
  })

  it('refuses a slot that is already claimed, and closes that socket', async () => {
    const first = await open('/controller-ws')
    expect(await hello(first, 'controller_1')).toMatchObject({ ok: true })
    const second = await open('/controller-ws')
    const closed = new Promise<number>((resolve) => second.once('close', resolve))
    expect(await hello(second, 'controller_1')).toMatchObject({ type: 'error', code: 'controller_in_use' })
    expect(await closed).toBe(1008)
    await shut(first, second)
  })

  it('will not let one socket steal the other slot', async () => {
    const phone = await open('/controller-ws')
    expect(await hello(phone, 'controller_1')).toMatchObject({ ok: true })
    expect(await hello(phone, 'controller_2')).toMatchObject({ type: 'error', code: 'controller_change_forbidden' })
    await shut(phone)
  })

  it('tells the game when a phone connects and when it drops', async () => {
    const game = await open('/controller-game-ws')
    const phone = await open('/controller-ws')
    const up = next(game, (m) => m.type === 'controller_status' && m.connected === true)
    await hello(phone, 'controller_1')
    expect(await up).toMatchObject({ controllerId: 'controller_1', connected: true })
    const down = next(game, (m) => m.type === 'controller_status' && m.connected === false)
    await shut(phone)
    expect(await down).toMatchObject({ controllerId: 'controller_1', connected: false })
    await shut(game)
  })

  it('tells a game that joins late which phones are already connected', async () => {
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    // the game arrives AFTER the phone, so it missed the claim broadcast
    const game = await open('/controller-game-ws')
    const roster = await next(game, (m) => m.type === 'controller_status' && m.connected === true)
    expect(roster).toMatchObject({ controllerId: 'controller_1', connected: true })
    await shut(phone, game)
  })

  it('rejects data sent before a claim, and rejects a mismatched controllerId', async () => {
    const a = await open('/controller-ws')
    const early = next(a, (m) => m.type === 'error')
    a.send(JSON.stringify({ v: 1, type: 'stick', controllerId: 'controller_1', seq: 1, stick: [0, 0] }))
    expect(await early).toMatchObject({ code: 'hello_required' })
    const b = await open('/controller-ws')
    await hello(b, 'controller_1')
    const mismatch = next(b, (m) => m.type === 'error')
    b.send(JSON.stringify({ v: 1, type: 'stick', controllerId: 'controller_2', seq: 2, stick: [0, 0] }))
    expect(await mismatch).toMatchObject({ code: 'controller_mismatch' })
    await shut(a, b)
  })

  it('passes a telemetry request through to the phones, and to phones that join later', async () => {
    const game = await open('/controller-game-ws')
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    const asked = next(phone, (m) => m.type === 'game_state' && m.telemetry === true)
    game.send(JSON.stringify({ type: 'game_state', sport: 'boxing', telemetry: true }))
    expect(await asked).toMatchObject({ telemetry: true })
    // The motion test page is usually already open when a phone is picked up, so the request has to
    // survive on the relay and reach the next phone through its hello acknowledgement.
    await shut(phone)
    const later = await open('/controller-ws')
    expect(await hello(later, 'controller_1')).toMatchObject({ ok: true, telemetry: true })
    const stopped = next(later, (m) => m.type === 'game_state' && m.telemetry === false)
    game.send(JSON.stringify({ type: 'game_state', sport: 'boxing', telemetry: false }))
    expect(await stopped).toMatchObject({ telemetry: false })
    await shut(later, game)
  })

  it('forwards movement summaries to the game and drops malformed ones', async () => {
    const game = await open('/controller-game-ws')
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    const delivered = next(game, (m) => m.type === 'activity')
    phone.send(JSON.stringify({ v: 1, type: 'activity', controllerId: 'controller_1', seq: 3, epochs: 'nope', roms: [] })) // malformed: ignored
    phone.send(JSON.stringify({ v: 1, type: 'activity', controllerId: 'controller_1', seq: 4, epochs: [{ t: 0, mean: 2, peak: 6, swings: 1, rotation: 80 }], roms: [95] }))
    expect(await delivered).toMatchObject({ type: 'activity', controllerId: 'controller_1', epochs: [{ t: 0, mean: 2 }], roms: [95] })
    await shut(phone, game)
  })

  it('answers ping with pong so the phone can measure round trip', async () => {
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    const pong = next(phone, (m) => m.type === 'pong')
    phone.send(JSON.stringify({ v: 1, type: 'ping', controllerId: 'controller_1', id: 42 }))
    expect(await pong).toMatchObject({ type: 'pong', id: 42 })
    await shut(phone)
  })

  it('ignores malformed traffic without dropping the connection', async () => {
    const game = await open('/controller-game-ws')
    const phone = await open('/controller-ws')
    await hello(phone, 'controller_1')
    phone.send('{not json')
    phone.send(JSON.stringify({ v: 1, type: 'gesture', controllerId: 'controller_1', seq: 20, eventId: 'bad', gesture: 'backflip' }))
    const good = next(game, (m) => m.type === 'gesture')
    phone.send(JSON.stringify({ v: 1, type: 'gesture', controllerId: 'controller_1', seq: 21, eventId: 'ok-1', gesture: 'punch', power: 50, direction: [0, 0, -1], peakAcceleration: 20, peakRotation: 90, duration: 100 }))
    expect(await good).toMatchObject({ gesture: 'punch' })
    expect(phone.readyState).toBe(WebSocket.OPEN)
    await shut(phone, game)
  })

  it('accepts head_tracker client and relays duck / sway actions to game sockets', async () => {
    const game = await open('/controller-game-ws')
    const tracker = await open('/controller-ws')
    const ack = await hello(tracker, 'head_tracker')
    expect(ack).toMatchObject({ ok: true, controllerId: 'head_tracker' })
    const duckAction = next(game, (m) => m.type === 'action' && m.action === 'duck')
    tracker.send(JSON.stringify({ v: 1, type: 'action', controllerId: 'head_tracker', seq: 10, eventId: 'head-duck-1', action: 'duck' }))
    expect(await duckAction).toMatchObject({ action: 'duck', controllerId: 'head_tracker' })
    await shut(tracker, game)
  })
})

#!/usr/bin/env node
// Load check: N rail sockets that bet on every market.window, plus one host socket that reads host.diagnostics
// (socket drops, arena tick jitter, projector frame p95 when a projector page is open). Node >= 22 (global WebSocket).
//
//   node scripts/load_check.mjs --url ws://localhost:8103 --n 12 --seconds 60
//
// Start a match in parallel (hostctl.py start / fake_remote.py --auto, or the projector's keyboard player) so windows open.
// Prints a summary and exits 1 only when no bet was ever acknowledged or a socket saw a seq gap it could not resync.
const args = Object.fromEntries(process.argv.slice(2).map((a, i, xs) => a.startsWith('--') ? [a.slice(2), xs[i + 1] && !xs[i + 1].startsWith('--') ? xs[i + 1] : 'true'] : []).filter(Boolean))
const URL_ = (args.url ?? 'ws://localhost:8000').replace(/\/$/, '')
const N = Number(args.n ?? 12)
const SECONDS = Number(args.seconds ?? 60)
const MAX_STAKE = Number(args.stake ?? 50)
const NICKS = ['Ace', 'Lucky', 'Whale', 'Rookie', 'Dice', 'Nova', 'Hawk', 'Slugger', 'Cash', 'Sly', 'Bolt', 'Pip']

if (typeof WebSocket === 'undefined') { console.error('global WebSocket missing: use Node >= 22'); process.exit(2) }

const stats = { bets: 0, acks: 0, rejections: 0, windows: 0, settles: 0, gaps: 0, resyncs: 0, messages: 0, errors: 0 }
let diag = null
let telemetry = null
const balances = new Map()

function connect(role, device, nickname, onMsg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${URL_}/ws?role=${role}&device=${device}`)
    let cseq = 0, lastSeq = 0
    const send = (t, d = {}) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t, cseq: ++cseq, d })) }
    ws.onopen = () => { send('session.hello', { role, device_id: device, nickname, ua: 'load_check', time_origin: 0, last_seq: 0 }); resolve({ ws, send }) }
    ws.onmessage = (ev) => {
      let env; try { env = JSON.parse(ev.data) } catch { return }
      stats.messages++
      if (env.seq > 0) {
        if (lastSeq > 0 && env.seq > lastSeq + 1 && env.t !== 'session.snapshot') { stats.gaps++; stats.resyncs++; send('session.resync', { last_seq: lastSeq }) }
        if (env.seq > lastSeq) lastSeq = env.seq
      }
      onMsg(env, send)
    }
    ws.onerror = () => { stats.errors++ }
    ws.onclose = () => {}
  })
}

const rails = []
for (let i = 0; i < N; i++) {
  const device = `load-${i}-${Math.random().toString(36).slice(2, 8)}`
  const seen = new Set()
  const c = await connect('rail', device, NICKS[i % NICKS.length] + (i >= NICKS.length ? String(i) : ''), (env, send) => {
    const d = env.d ?? {}
    if (env.t === 'session.welcome' && typeof d.balance === 'number') balances.set(device, d.balance)
    if (env.t === 'market.balance' && typeof d.balance === 'number') balances.set(device, d.balance)
    if (env.t === 'market.bet_ack') { if (typeof d.balance === 'number') balances.set(device, d.balance); if (d.ok) stats.acks++; else stats.rejections++ }
    if (env.t === 'market.settle') stats.settles++
    const windows = env.t === 'market.window' ? [d] : env.t === 'session.snapshot' ? (d.markets ?? []) : []
    for (const w of windows) {
      if (!w?.open || seen.has(w.market_id)) continue
      seen.add(w.market_id); stats.windows++
      const bal = balances.get(device) ?? 0
      const stake = Math.min(MAX_STAKE, Math.max(10, 10 * Math.ceil(Math.random() * (MAX_STAKE / 10))))
      if (bal < stake) continue
      const outcome = w.outcomes[Math.floor(Math.random() * w.outcomes.length)]
      setTimeout(() => { stats.bets++; send('market.bet', { market_id: w.market_id, outcome_id: outcome.id, stake }) }, Math.random() * 1500)
    }
  })
  rails.push(c)
}
const host = await connect('host', `load-host-${Math.random().toString(36).slice(2, 8)}`, 'load_check', (env) => {
  if (env.t === 'host.diagnostics' && env.d?.arena) { diag = env.d.arena; if (env.d.telemetry && Object.keys(env.d.telemetry).length) telemetry = env.d.telemetry; diag.sockets = env.d.sockets }
})

console.log(`[load_check] ${N} rail sockets + host on ${URL_} for ${SECONDS}s`)
const t0 = Date.now()
const tick = setInterval(() => {
  const el = ((Date.now() - t0) / 1000).toFixed(0)
  const fr = telemetry ? ` projector frame p95=${telemetry.frame_ms_p95} ms fps=${telemetry.fps}` : ' (no projector telemetry)'
  const tk = diag ? ` tick p95=${diag.tick_p95_ms} ms drops=${diag.dropped_total}` : ''
  console.log(`[load_check] t=${el}s bets=${stats.bets} acks=${stats.acks} rejections=${stats.rejections} windows=${stats.windows} settles=${stats.settles} msgs=${stats.messages}${tk}${fr}`)
}, 5000)
await new Promise((r) => setTimeout(r, SECONDS * 1000))
clearInterval(tick)
for (const c of rails) c.ws.close()
host.ws.close()

const total = [...balances.values()].reduce((a, b) => a + b, 0)
const loadSockets = (diag?.sockets ?? []).filter((s) => String(s.device_id ?? '').startsWith('load-'))
const summary = {
  sockets: N, seconds: SECONDS, bets_sent: stats.bets, bet_acks: stats.acks, bet_rejections: stats.rejections, windows_seen: stats.windows, settles_seen: stats.settles,
  messages: stats.messages, seq_gaps: stats.gaps, socket_errors: stats.errors, balances_sum: total,
  arena_tick_p95_ms: diag?.tick_p95_ms ?? null, arena_tick_max_ms: diag?.tick_max_ms ?? null, server_drops_on_our_sockets: loadSockets.reduce((a, s) => a + (s.dropped ?? 0), 0),
  projector_frame_p95_ms: telemetry?.frame_ms_p95 ?? null, projector_fps: telemetry?.fps ?? null,
}
console.log('[load_check] summary ' + JSON.stringify(summary))
const frameOk = summary.projector_frame_p95_ms === null || summary.projector_frame_p95_ms < 20
const ok = stats.errors === 0 && (stats.windows === 0 || stats.acks > 0) && frameOk
console.log(ok ? '[load_check] PASS' + (summary.projector_frame_p95_ms === null ? ' (open /projector to include frame time)' : '') : '[load_check] FAIL')
process.exit(ok ? 0 : 1)

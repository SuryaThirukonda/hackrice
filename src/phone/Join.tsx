import { useEffect, useState } from 'react'
import { QR } from './QR'
import './join.css'

export default function Join() {
  const [origin, setOrigin] = useState(location.origin)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    if (location.protocol === 'https:') return
    const refresh = () => fetch('/join-config.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.origin?.startsWith('https://')) setOrigin(data.origin) })
      .catch(() => {})
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])
  let base = ''
  try { const url = new URL(origin); if (url.protocol === 'https:') base = url.origin } catch { /* show inline guidance */ }
  return <main className="join-club">
    <header><span>✦ SPORTS CLUB</span><a href="/">Big screen</a></header>
    <h1>A little motion.<br/><em>A lot of play.</em></h1>
    <p>Your phone is the controller. The big screen is your playground.</p>
    <div className="club-sports"><span>🥊 Boxing ring</span><span>⛳ Mini golf</span><span>🎳 Bowling alley</span></div>
    <section className="join-card"><div><span className="club-tag">YOU'RE UP</span><h2>Controller 1</h2><p>Scan with your phone camera.<br/>Enable motion, connect, then calibrate.</p><a className="club-cta" href="/controller.html?player=1">Open controller →</a></div><div>{base ? <QR value={base + '/controller.html?player=1'} size={208} label="Scan to play" /> : <div className="qr-empty">Your join QR<br/>will appear here ↓</div>}</div></section>
    <div className="club-opponent"><span>🎮</span><div><b>Play a friend or the House</b><p>Keyboard still works. The phone just adds motion.</p></div></div>
    <section className="join-card"><div><span className="club-tag">BRING A FRIEND</span><h2>Controller 2</h2><p>Scan on a second phone for two-human play.</p><a className="club-cta" href="/controller.html?player=2">Open Controller 2 →</a></div>{base && <QR value={base + '/controller.html?player=2'} size={208} label="Controller 2 · scan to play" />}</section>
    <details open={!base} className="club-settings"><summary>Phone join link & testing</summary><label>Paste the HTTPS tunnel address<input type="url" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://your-tunnel.trycloudflare.com" /></label>{!base && <p>Phones need your HTTPS tunnel address for motion access. A localhost QR would point at the phone itself.</p>}<label><input type="checkbox" checked={testing} onChange={e => setTesting(e.target.checked)} /> Show extra Controller 2 test QR</label>{testing && base && <QR value={base + '/controller.html?player=2'} size={180} label="Controller 2 · testing" />}<a href="/controller.html?player=1&fake=1&debug=1">Desktop motion diagnostics</a></details>
    <footer>The big screen picks the sport · add &amp;debug=1 for telemetry</footer>
  </main>
}

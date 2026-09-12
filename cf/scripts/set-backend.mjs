// Point the edge Worker at the laptop's current tunnel URL:  npm run set-backend -- https://xxxx.trycloudflare.com
// Needs WORKER_URL (https://hap.<account>.workers.dev) and ADMIN_KEY in the environment.
const [, , target] = process.argv
const worker = process.env.WORKER_URL, key = process.env.ADMIN_KEY
if (!target || !worker || !key) { console.error('usage: WORKER_URL=https://hap.xxx.workers.dev ADMIN_KEY=... npm run set-backend -- https://tunnel-url'); process.exit(1) }
const r = await fetch(`${worker}/backend/set?url=${encodeURIComponent(target)}`, { method: 'POST', headers: { 'x-admin-key': key } })
console.log(r.status, await r.text())

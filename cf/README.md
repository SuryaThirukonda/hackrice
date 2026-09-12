# Edge front door (Cloudflare Worker)

Serves the built web app (`web/dist`) at a stable `https://hap.<account>.workers.dev` and proxies the game traffic
(`/ws` with WebSocket upgrade, `/api/*`, `/audio/*`) to the laptop game server, whose URL lives in KV (`hap-config`).
Phones scan QR codes with the stable Worker URL; when the tunnel URL changes, only the KV value changes.

```bash
cd cf && npm i
npx wrangler login                                   # one time (interactive) or export CLOUDFLARE_API_TOKEN
npx wrangler secret put ADMIN_KEY                    # any long random string
npm run deploy                                       # builds web/dist and deploys the Worker
WORKER_URL=https://hap.<account>.workers.dev ADMIN_KEY=... npm run set-backend -- https://<tunnel>.trycloudflare.com
```

Then on the host page set the public URL to the Worker URL so the QR codes use it. Local check: `npm run dev` (serves at :8787
with the same routing; set `BACKEND_URL` in `.dev.vars` to `http://localhost:8000`).

Notes: the game server is still the single authority and runs on the laptop; the Worker only relays bytes. A future
step is to port the arena loop into a Durable Object so no laptop is needed.

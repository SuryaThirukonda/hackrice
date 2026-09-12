import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'

/**
 * A Cloudflare quick tunnel: an outbound connection from this machine that Cloudflare answers on a
 * throwaway `*.trycloudflare.com` hostname. No account, no login, no deploy. Shared by the standalone
 * `npm run tunnel` and by the Vite dev/preview plugin, so both spawn and scrape it the same way.
 */
const HOSTNAME = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

/** Prefer a cloudflared the user installed themselves; fall back to the one npm vendored. */
const binary = () => {
  try { return createRequire(import.meta.url)('cloudflared').bin } catch { return 'cloudflared' }
}

/** This machine's LAN address. Phones on the same WiFi can reach it, but with no HTTPS and so no motion. */
export function lanOrigin(port) {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return `http://${address.address}:${port}`
    }
  }
  return ''
}

/**
 * Start a quick tunnel in front of `port`.
 * `onOrigin` fires once with the assigned HTTPS origin; `onError` fires if cloudflared never starts.
 * Returns a stop function; the tunnel dies with the process either way.
 */
export function startQuickTunnel({ port, onOrigin, onError, quiet = false }) {
  const child = spawn(binary(), ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let found = false
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    if (!quiet) process.stderr.write(chunk)
    if (found) return
    const match = HOSTNAME.exec(chunk)
    if (!match) return
    found = true
    onOrigin?.(match[0])
  })
  child.on('error', (error) => { onError?.(error) })
  child.on('exit', (code) => { if (!found) onError?.(new Error(`cloudflared exited with code ${code}`)) })
  return () => { child.kill('SIGTERM') }
}

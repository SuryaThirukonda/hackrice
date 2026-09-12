#!/usr/bin/env node
/**
 * Standalone Cloudflare quick tunnel.
 *
 * `npm run dev` already starts one by itself (see the tunnel plugin in `vite.config.ts`), so this is
 * for the cases that plugin does not cover: tunnelling a production server, a host that is not Vite,
 * or a second tunnel from another machine. It writes `public/join-config.json`, which Vite serves as
 * a static file and the in-game connect screen polls, and deletes it on exit so a dead tunnel never
 * leaves a QR code pointing at nothing.
 *
 * Usage:  npm run tunnel  [-- --port 5174]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lanOrigin, startQuickTunnel } from './quickTunnel.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'public', 'join-config.json')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const port = Number(arg('port', '5174'))

const unpublish = () => { try { rmSync(CONFIG) } catch { /* already gone */ } }

const stop = startQuickTunnel({
  port,
  onOrigin: (origin) => {
    mkdirSync(dirname(CONFIG), { recursive: true })
    writeFileSync(CONFIG, `${JSON.stringify({ origin, lan: lanOrigin(port), port }, null, 2)}\n`)
    process.stdout.write([
      '',
      '  ┌─────────────────────────────────────────────────────────',
      `  │  Phones join at   ${origin}/join.html`,
      `  │  Controller 1     ${origin}/controller.html?player=1`,
      `  │  Big screen        http://localhost:${port}/`,
      '  │',
      '  │  Written to public/join-config.json — the in-game connect',
      '  │  screen picks it up within a few seconds.',
      '  └─────────────────────────────────────────────────────────',
      '',
    ].join('\n'))
  },
  onError: (error) => {
    console.error(`\ncloudflared failed: ${error.message}`)
    console.error('Install it with `npm i -D cloudflared`, or put cloudflared on your PATH.\n')
    process.exitCode = 1
    unpublish()
  },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { unpublish(); stop(); process.exit(0) })
}
process.on('exit', unpublish)

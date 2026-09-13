import { lanOrigin, startQuickTunnel } from './quickTunnel.mjs'

/**
 * Starts a Cloudflare quick tunnel alongside the dev (and preview) server and answers
 * `GET /join-config.json` with the address it was given.
 *
 * The point is that the in-game "connect a phone" screen is never empty: you run one command, open
 * the game, and the QR code is already there. Nothing is deployed and no account is involved. The
 * tunnel is an outbound connection that dies with the server, and its hostname is new every run,
 * which is exactly why the address is served at runtime instead of baked into the build.
 *
 * Set `HAP_NO_TUNNEL=1` to keep the server entirely local.
 */
export function cloudflareTunnel() {
  let origin = ''
  let lan = ''
  let failure = ''
  let stop = null

  const begin = (server, label, configuredPort) => {
    let port = configuredPort
    // The config route answers from memory. When no tunnel is up it falls through, so a
    // `public/join-config.json` written by the standalone script is still served as a static file.
    server.middlewares.use('/join-config.json', (_req, res, next) => {
      if (!origin && !lan) return next()
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({ origin, lan, port, error: failure || undefined }))
    })
    const launch = () => {
      // Vite may bind the next available port when the configured one is occupied. Resolve the
      // actual listening port before starting cloudflared; otherwise the tunnel forwards to a
      // stale server and the QR controller appears connected but never reaches this game.
      const address = server.httpServer?.address()
      if (typeof address === 'object' && address) port = address.port
      lan = lanOrigin(port)
      if (process.env.HAP_NO_TUNNEL === '1') {
        failure = 'tunnel disabled by HAP_NO_TUNNEL'
        return
      }
      stop = startQuickTunnel({
        port,
        quiet: true,
        onOrigin: (value) => {
          origin = value
          server.config.logger.info(`\n  ➜  Phones:   ${value}/join.html   (${label} tunnel, scan it in-game)\n`)
        },
        onError: (error) => {
          failure = error.message
          server.config.logger.warn(`\n  ➜  Phones:   no HTTPS tunnel (${error.message}). Phones can still use ${lan} for buttons only.\n`)
        },
      })
    }
    if (server.httpServer?.listening) launch()
    else server.httpServer?.once('listening', launch)
    server.httpServer?.on('close', () => { stop?.(); stop = null })
  }

  // No `apply` filter: the plugin is inert during a plain build because neither hook runs there.
  return {
    name: 'hap:cloudflare-tunnel',
    configureServer(server) { begin(server, 'dev', server.config.server?.port ?? 5174) },
    configurePreviewServer(server) { begin(server, 'preview', server.config.preview?.port ?? server.config.server?.port ?? 5174) },
  }
}

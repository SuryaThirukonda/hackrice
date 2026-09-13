import { lanOrigin, startQuickTunnel } from './quickTunnel.mjs'

/** How long a starting tunnel may take before phones are offered the same-WiFi address instead. */
export const TUNNEL_GRACE_MS = 20_000

/**
 * The body of `GET /join-config.json`, or null to fall through to a static file.
 *
 * Phones get the HTTPS tunnel whenever there is one, because only a secure page can read the motion
 * sensors. While the tunnel is still starting nothing is offered, so a phone scanned in those first
 * seconds does not land on a LAN page whose sensors cannot work. The same-WiFi address (D-pad and
 * buttons only) is offered once the tunnel has failed, is disabled, or has been starting for longer than
 * TUNNEL_GRACE_MS: cloudflared can hang without ever reporting an error, and the connect screen must not
 * stay empty when no tunnel is coming.
 */
export function joinConfig({ origin, lan, port, failure, startingForMs = 0 }) {
  if (origin) return { origin, lan, port, error: failure || undefined }
  if (lan && (failure || startingForMs >= TUNNEL_GRACE_MS)) return { origin: '', lan, port, error: failure || undefined }
  return null
}

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

  const begin = (server, label, port) => {
    lan = lanOrigin(port)
    const startedAt = Date.now()
    // The config route answers from memory. While it has nothing to offer it falls through, so a
    // `public/join-config.json` written by the standalone script is still served as a static file.
    server.middlewares.use('/join-config.json', (_req, res, next) => {
      const body = joinConfig({ origin, lan, port, failure, startingForMs: Date.now() - startedAt })
      if (!body) return next()
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(body))
    })
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
    server.httpServer?.on('close', () => { stop?.(); stop = null })
  }

  // No `apply` filter: the plugin is inert during a plain build because neither hook runs there.
  return {
    name: 'hap:cloudflare-tunnel',
    configureServer(server) { begin(server, 'dev', server.config.server?.port ?? 5174) },
    configurePreviewServer(server) { begin(server, 'preview', server.config.preview?.port ?? server.config.server?.port ?? 5174) },
  }
}

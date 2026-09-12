/**
 * Where a phone should point its browser.
 *
 * Motion is the constraint. Browsers only expose DeviceMotion on a secure origin, so a phone that
 * reaches the game over `http://192.168.x.x` gets the page, the D-pad and the buttons, but no
 * swings. HTTPS comes from a Cloudflare quick tunnel, started automatically beside the dev server,
 * whose hostname is new on every run and therefore cannot be baked into the build. This module is
 * the one place that reads the live address.
 */

/**
 * How the address was found, worst to best:
 * `none` nothing usable, `lan` same-WiFi HTTP so buttons work but motion does not,
 * `tunnel` the HTTPS quick tunnel, `page` the big screen is itself being viewed through HTTPS.
 */
export type JoinSource = 'page' | 'tunnel' | 'lan' | 'none'
export interface JoinLink {
  /** Origin a phone can reach, or '' when there is nothing to offer. */
  origin: string
  source: JoinSource
}

export const NO_LINK: JoinLink = { origin: '', source: 'none' }

/** True when the link can carry motion. A LAN address cannot: no secure context, no DeviceMotion. */
export const supportsMotion = (link: JoinLink): boolean => link.source === 'page' || link.source === 'tunnel'

/** The URL a phone opens to claim a controller slot. Empty when there is no usable origin. */
export const controllerUrl = (link: JoinLink, player: 1 | 2): string =>
  link.origin ? `${link.origin}/controller.html?player=${player}` : ''

const originOf = (value: unknown, ...protocols: string[]): string => {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) ? url.origin : ''
  } catch { return '' }
}

/**
 * Resolve the phone-facing address. Never rejects: a missing or malformed config is simply "nothing
 * yet", which the connect screen renders as guidance rather than as an error.
 */
export async function resolveJoinLink(fetchImpl: typeof fetch = fetch): Promise<JoinLink> {
  // Viewing the big screen over HTTPS already proves that origin reaches this machine from outside.
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return { origin: location.origin, source: 'page' }
  }
  try {
    const response = await fetchImpl('/join-config.json', { cache: 'no-store' })
    if (!response.ok) return NO_LINK
    const data = (await response.json()) as { origin?: unknown; lan?: unknown } | null
    const tunnel = originOf(data?.origin, 'https:')
    if (tunnel) return { origin: tunnel, source: 'tunnel' }
    const lan = originOf(data?.lan, 'http:', 'https:')
    return lan ? { origin: lan, source: 'lan' } : NO_LINK
  } catch {
    return NO_LINK
  }
}

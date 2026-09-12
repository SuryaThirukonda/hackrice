import { afterEach, describe, expect, it } from 'vitest'
import { controllerUrl, resolveJoinLink, supportsMotion } from './joinLink'

/** A stand-in for the network: one canned response, or a thrown error. */
const serving = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body }) as unknown as Response) as unknown as typeof fetch
const offline: typeof fetch = (async () => { throw new Error('no server') }) as unknown as typeof fetch

/** The test environment is node, so `location` is absent unless a test puts one there. */
const asPage = (protocol: string, origin: string): void => {
  ;(globalThis as unknown as { location?: unknown }).location = { protocol, origin }
}
afterEach(() => { delete (globalThis as unknown as { location?: unknown }).location })

describe('join link', () => {
  it('trusts the page origin when the big screen is already on HTTPS', async () => {
    asPage('https:', 'https://tunnel.example.com')
    // The config file is not even consulted: being served over HTTPS proves the origin works.
    expect(await resolveJoinLink(offline)).toEqual({ origin: 'https://tunnel.example.com', source: 'page' })
  })

  it('reads the live tunnel address from the config file when the page is on http', async () => {
    asPage('http:', 'http://localhost:5174')
    expect(await resolveJoinLink(serving({ origin: 'https://abc-def.trycloudflare.com', port: 5174 })))
      .toEqual({ origin: 'https://abc-def.trycloudflare.com', source: 'tunnel' })
  })

  it('falls back to the same-WiFi address, flagged as unable to carry motion', async () => {
    asPage('http:', 'http://localhost:5174')
    const link = await resolveJoinLink(serving({ origin: '', lan: 'http://192.168.1.20:5174' }))
    expect(link).toEqual({ origin: 'http://192.168.1.20:5174', source: 'lan' })
    // The distinction matters: a phone on this address gets the D-pad but never the accelerometer.
    expect(supportsMotion(link)).toBe(false)
    expect(supportsMotion({ origin: 'https://x.trycloudflare.com', source: 'tunnel' })).toBe(true)
    expect(supportsMotion({ origin: 'https://big.screen', source: 'page' })).toBe(true)
  })

  it('never treats a non-HTTPS tunnel value as a tunnel', async () => {
    // ws and garbage origins are not addresses a browser can open at all.
    for (const origin of ['ws://tunnel.example.com', 'not a url', '', null, 42]) {
      expect((await resolveJoinLink(serving({ origin }))).source).not.toBe('tunnel')
    }
    // An http value in the tunnel field is demoted, not promoted.
    expect((await resolveJoinLink(serving({ origin: 'http://localhost:5174' }))).origin).toBe('')
  })

  it('treats a missing file, a bad body and a dead server as "no tunnel yet", never as an error', async () => {
    expect(await resolveJoinLink(serving({ origin: 'https://x.example.com' }, false))).toEqual({ origin: '', source: 'none' })
    expect(await resolveJoinLink(serving(null))).toEqual({ origin: '', source: 'none' })
    expect(await resolveJoinLink(offline)).toEqual({ origin: '', source: 'none' })
  })

  it('builds one controller URL per player, and nothing at all without an origin', () => {
    const link = { origin: 'https://abc.trycloudflare.com', source: 'tunnel' } as const
    expect(controllerUrl(link, 1)).toBe('https://abc.trycloudflare.com/controller.html?player=1')
    expect(controllerUrl(link, 2)).toBe('https://abc.trycloudflare.com/controller.html?player=2')
    expect(controllerUrl({ origin: '', source: 'none' }, 1)).toBe('')
  })
})

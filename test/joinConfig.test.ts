import { describe, expect, it } from 'vitest'
// @ts-expect-error plain-JS Vite plugin (shared with the standalone tunnel script) ships no type declarations
import { joinConfig, TUNNEL_GRACE_MS } from '../scripts/tunnelPlugin.mjs'

const LAN = 'http://192.168.1.20:5174'
const TUNNEL = 'https://calm-river-demo.trycloudflare.com'

describe('what the dev server tells phones to open', () => {
  it('gives the HTTPS tunnel once it is up', () => {
    expect(joinConfig({ origin: TUNNEL, lan: LAN, port: 5174, failure: '' })).toEqual({ origin: TUNNEL, lan: LAN, port: 5174 })
  })

  it('offers nothing while the tunnel is starting, so no phone lands on a page without motion sensors', () => {
    expect(joinConfig({ origin: '', lan: LAN, port: 5174, failure: '', startingForMs: 3_000 })).toBeNull()
  })

  it('falls back to the same-WiFi address when the tunnel failed or is disabled', () => {
    expect(joinConfig({ origin: '', lan: LAN, port: 5174, failure: 'tunnel disabled by HAP_NO_TUNNEL' }))
      .toEqual({ origin: '', lan: LAN, port: 5174, error: 'tunnel disabled by HAP_NO_TUNNEL' })
  })

  it('falls back to the same-WiFi address when the tunnel never reports in', () => {
    expect(joinConfig({ origin: '', lan: LAN, port: 5174, failure: '', startingForMs: TUNNEL_GRACE_MS })?.lan).toBe(LAN)
  })

  it('falls through when there is no address at all', () => {
    expect(joinConfig({ origin: '', lan: '', port: 5174, failure: 'no network' })).toBeNull()
  })
})

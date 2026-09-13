import { describe, expect, it } from 'vitest'
import { encodeFrameHeader, FRAME_FORMAT_RGB, FRAME_HEADER_BYTES, type FrameTarget, handleFrameMessage, parseFrameHeader } from './vitalsFrames'

const header = { width: 480, height: 270, stride: 1440, timestampUs: 1_760_000_000_123_456, format: FRAME_FORMAT_RGB }
const frame = (h = header): Uint8Array => {
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + h.stride * h.height)
  bytes[FRAME_HEADER_BYTES] = 7
  return encodeFrameHeader(h, bytes)
}
const text = (s: string): Uint8Array => new TextEncoder().encode(s)
function fakeVitals(source: string | null): FrameTarget & { pushed: { width: number; height: number; stride: number; timestampUs: number; first: number }[] } {
  const pushed: { width: number; height: number; stride: number; timestampUs: number; first: number }[] = []
  return {
    state: { source, status: 'running' },
    pushed,
    pushFrame: (buf, width, height, stride, timestampUs) => { pushed.push({ width, height, stride, timestampUs, first: buf[0] }); return true },
  }
}

describe('camera frame header', () => {
  it('round-trips a frame header, microsecond timestamps included', () => {
    const got = parseFrameHeader(encodeFrameHeader(header))
    expect(got).toEqual(header)
  })
  it('writes into the front of a frame buffer without disturbing the pixels', () => {
    const frame = new Uint8Array(FRAME_HEADER_BYTES + 480 * 270 * 3)
    frame[FRAME_HEADER_BYTES] = 200
    frame[frame.length - 1] = 12
    encodeFrameHeader(header, frame)
    expect(parseFrameHeader(frame)).toEqual(header)
    expect(frame[FRAME_HEADER_BYTES]).toBe(200)
    expect(frame[frame.length - 1]).toBe(12)
  })
  it('reads a Node Buffer view the socket hands over', () => {
    const buf = Buffer.from(encodeFrameHeader(header))
    expect(parseFrameHeader(buf)?.timestampUs).toBe(header.timestampUs)
  })
  it('refuses anything that is not one of our frames', () => {
    expect(parseFrameHeader(new Uint8Array(8))).toBeNull()
    const wrongMagic = encodeFrameHeader(header)
    wrongMagic[0] ^= 0xff
    expect(parseFrameHeader(wrongMagic)).toBeNull()
    expect(parseFrameHeader(encodeFrameHeader({ ...header, width: 0 }))).toBeNull()
    expect(parseFrameHeader(encodeFrameHeader({ ...header, stride: 100 }))).toBeNull()
  })
})

describe('camera frame socket', () => {
  it('refuses every frame until a custom-input reading has been asked for', () => {
    const off = fakeVitals(null)
    expect(handleFrameMessage(off, text('hello'), false)).toEqual({ type: 'error', code: 'vitals_not_started', message: expect.stringContaining('/vitals/start') })
    handleFrameMessage(off, frame(), true)
    expect(off.pushed).toHaveLength(0)
    const camera = fakeVitals('camera')
    expect(handleFrameMessage(camera, text('hello'), false)?.type).toBe('error')
  })
  it('acks the page and forwards its frames, pixels only', () => {
    const v = fakeVitals('custom')
    expect(handleFrameMessage(v, text(JSON.stringify({ type: 'hello' })), false)).toEqual({ type: 'hello', ok: true, status: 'running' })
    expect(handleFrameMessage(v, frame(), true)).toBeNull()
    expect(v.pushed).toEqual([{ width: 480, height: 270, stride: 1440, timestampUs: header.timestampUs, first: 7 }])
  })
  it('drops junk, other pixel formats and short frames rather than passing them to the SDK', () => {
    const v = fakeVitals('custom')
    handleFrameMessage(v, text('not a frame'), false)
    handleFrameMessage(v, new Uint8Array(64), true)
    handleFrameMessage(v, encodeFrameHeader(header), true) // header with no pixels behind it
    handleFrameMessage(v, frame({ ...header, format: 2 }), true)
    expect(v.pushed).toHaveLength(0)
  })
})

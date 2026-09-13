/**
 * Wire format for browser-owned camera frames.
 *
 * One camera, one permission: the page opens the camera itself, shows the live preview, and pushes the
 * SAME frames down a local socket to this service, which hands them to the SDK's custom input. The
 * header is fixed-size and little-endian so both ends can read it with a DataView and no dependency.
 */
export const FRAME_MAGIC = 0x54504631 // 'TPF1'
export const FRAME_HEADER_BYTES = 24
export const FRAME_FORMAT_RGB = 0

export interface FrameHeader { width: number; height: number; stride: number; timestampUs: number; format: number }

export function encodeFrameHeader(h: FrameHeader, into?: Uint8Array): Uint8Array {
  const bytes = into ?? new Uint8Array(FRAME_HEADER_BYTES)
  const view = new DataView(bytes.buffer, bytes.byteOffset, FRAME_HEADER_BYTES)
  view.setUint32(0, FRAME_MAGIC, true)
  view.setUint16(4, h.width, true)
  view.setUint16(6, h.height, true)
  view.setUint32(8, h.stride, true)
  // Microsecond timestamps outgrow a u32, and a u64 read is not worth a BigInt on the hot path: two words.
  view.setUint32(12, h.timestampUs % 0x1_0000_0000, true)
  view.setUint32(16, Math.floor(h.timestampUs / 0x1_0000_0000), true)
  view.setUint32(20, h.format, true)
  return bytes
}

/** Null for anything that is not one of our frames, so a stray socket message cannot reach the SDK. */
export function parseFrameHeader(bytes: Uint8Array): FrameHeader | null {
  if (bytes.byteLength < FRAME_HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, FRAME_HEADER_BYTES)
  if (view.getUint32(0, true) !== FRAME_MAGIC) return null
  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const stride = view.getUint32(8, true)
  const timestampUs = view.getUint32(12, true) + view.getUint32(16, true) * 0x1_0000_0000
  const format = view.getUint32(20, true)
  if (width === 0 || height === 0 || stride < width) return null
  return { width, height, stride, timestampUs, format }
}

/** The slice of VitalsBridge the frame socket needs. */
export interface FrameTarget {
  state: { source: string | null; status: string }
  pushFrame: (buf: Uint8Array, width: number, height: number, stride: number, timestampUs: number) => boolean
}
export type FrameReply = { type: 'hello'; ok: true; status: string } | { type: 'error'; code: string; message: string }

/**
 * One socket message from the page. Consent is explicit and happens over HTTP: until the reading has been
 * started in custom-input mode, the socket takes no frames at all. An error reply is terminal.
 */
export function handleFrameMessage(target: FrameTarget, data: Uint8Array, isBinary: boolean): FrameReply | null {
  if (!isBinary) {
    const text = new TextDecoder().decode(data)
    if (text !== 'hello' && !/"type"\s*:\s*"hello"/.test(text)) return null
    if (target.state.source !== 'custom') return { type: 'error', code: 'vitals_not_started', message: 'start the reading first: POST /vitals/start { input: "custom" }' }
    return { type: 'hello', ok: true, status: target.state.status }
  }
  if (target.state.source !== 'custom') return null
  const header = parseFrameHeader(data)
  if (!header || header.format !== FRAME_FORMAT_RGB) return null
  if (data.byteLength < FRAME_HEADER_BYTES + header.stride * header.height) return null
  target.pushFrame(data.subarray(FRAME_HEADER_BYTES), header.width, header.height, header.stride, header.timestampUs)
  return null
}

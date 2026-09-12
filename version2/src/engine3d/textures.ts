import { ADDRESS_REPEAT, FILTER_LINEAR_MIPMAP_LINEAR, PIXELFORMAT_RGBA8, Texture, type GraphicsDevice } from 'playcanvas'

function toTexture(device: GraphicsDevice, c: HTMLCanvasElement, name: string, repeat = true): Texture {
  const t = new Texture(device, { width: c.width, height: c.height, format: PIXELFORMAT_RGBA8, mipmaps: true, name })
  t.setSource(c)
  if (repeat) { t.addressU = ADDRESS_REPEAT; t.addressV = ADDRESS_REPEAT }
  t.minFilter = FILTER_LINEAR_MIPMAP_LINEAR
  return t
}
const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] }
/** Small deterministic PRNG so textures are identical every run. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** Soft noise for grain (canvas, felt, grass): base colour with speckles. */
export function noiseTex(device: GraphicsDevice, base: string, speck: string, density = 0.18, size = 128, seed = 7): Texture {
  const [c, ctx] = canvas(size, size), r = rng(seed)
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = speck
  for (let i = 0; i < size * size * density; i++) { ctx.globalAlpha = 0.15 + r() * 0.35; ctx.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2)) }
  ctx.globalAlpha = 1
  return toTexture(device, c, 'noise')
}
/** Normal map from a noise height field (tangent-space, unit strength scaled by `bump`). */
export function bumpTex(device: GraphicsDevice, size = 128, bump = 1.5, seed = 11): Texture {
  const r = rng(seed), h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) h[i] = r()
  // blur once for softer grain
  const hb = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + size) % size) * size + ((x + dx + size) % size)]; hb[y * size + x] = s / 9 }
  const [c, ctx] = canvas(size, size), img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hb[y * size + ((x - 1 + size) % size)], rr = hb[y * size + ((x + 1) % size)], u = hb[((y - 1 + size) % size) * size + x], d = hb[((y + 1) % size) * size + x]
    const nx = (l - rr) * bump, ny = (u - d) * bump, len = Math.hypot(nx, ny, 1)
    const i = (y * size + x) * 4
    img.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255); img.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255); img.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255); img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return toTexture(device, c, 'bump')
}
/** Horizontal stripes (apron bands, warning tape, oil sheen). */
export function stripeTex(device: GraphicsDevice, colors: string[], size = 64, angleDeg = 0): Texture {
  const [c, ctx] = canvas(size, size)
  ctx.translate(size / 2, size / 2); ctx.rotate((angleDeg * Math.PI) / 180); ctx.translate(-size / 2, -size / 2)
  const h = size / colors.length
  colors.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(-size, i * h, size * 3, h + 1) })
  return toTexture(device, c, 'stripes')
}
/** Radial soft spot (alpha) for spotlight cones and glow cards. */
export function glowTex(device: GraphicsDevice, color = '#ffffff', size = 128): Texture {
  const [c, ctx] = canvas(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, color); g.addColorStop(0.5, color.length === 7 ? color + '80' : color); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size)
  return toTexture(device, c, 'glow', false)
}
/** Vertical gradient (alpha) for volumetric cones: opaque at the top, transparent at the bottom. */
export function coneTex(device: GraphicsDevice, color = '#fff1cf', size = 64): Texture {
  const [c, ctx] = canvas(size, size)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00')
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size)
  return toTexture(device, c, 'cone', false)
}
/** Crowd silhouette cards: three poses (arms down, one up, both up) drawn as dark shapes with a lighter head. */
export function crowdTex(device: GraphicsDevice, pose: 0 | 1 | 2, color = '#1b1330', size = 64): Texture {
  const [c, ctx] = canvas(size, size)
  ctx.fillStyle = color
  ctx.fillRect(size * 0.3, size * 0.42, size * 0.4, size * 0.58) // torso
  ctx.beginPath(); ctx.arc(size * 0.5, size * 0.3, size * 0.14, 0, Math.PI * 2); ctx.fill() // head
  ctx.lineWidth = size * 0.1; ctx.strokeStyle = color; ctx.lineCap = 'round'
  const arm = (side: -1 | 1, up: boolean) => { ctx.beginPath(); ctx.moveTo(size * (0.5 + side * 0.2), size * 0.5); ctx.lineTo(size * (0.5 + side * (up ? 0.32 : 0.28)), size * (up ? 0.12 : 0.78)); ctx.stroke() }
  arm(-1, pose === 2); arm(1, pose >= 1)
  return toTexture(device, c, 'crowd' + pose, false)
}
/** Decal: scuffs and tape marks on a transparent card. */
export function scuffTex(device: GraphicsDevice, size = 128, seed = 5): Texture {
  const [c, ctx] = canvas(size, size), r = rng(seed)
  ctx.strokeStyle = 'rgba(40,30,20,0.35)'; ctx.lineWidth = 2
  for (let i = 0; i < 18; i++) { ctx.beginPath(); const x = r() * size, y = r() * size; ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 14); ctx.stroke() }
  return toTexture(device, c, 'scuff', false)
}
/** Leather grain: dense fine speckle in two tones (gloves, seats). */
export const leatherTex = (device: GraphicsDevice, base: string, seed = 13): Texture => noiseTex(device, base, '#000000', 0.5, 64, seed)
/** Woven fabric: fine cross-hatch (trunks, canvas, crowd rows). */
export function weaveTex(device: GraphicsDevice, base: string, thread: string, size = 64): Texture {
  const [c, ctx] = canvas(size, size)
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = thread; ctx.globalAlpha = 0.28; ctx.lineWidth = 1
  for (let i = 0; i < size; i += 4) { ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(size, i + 0.5); ctx.stroke() }
  ctx.globalAlpha = 1
  return toTexture(device, c, 'weave')
}
/** Wood planks: long grain lines with plank seams. */
export function woodTex(device: GraphicsDevice, base: string, grain: string, seam: string, size = 128, seed = 17): Texture {
  const [c, ctx] = canvas(size, size), r = rng(seed)
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = grain; ctx.lineWidth = 1
  for (let i = 0; i < 90; i++) { ctx.globalAlpha = 0.12 + r() * 0.2; const y = r() * size; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 4, size * 0.7, y + (r() - 0.5) * 4, size, y + (r() - 0.5) * 2); ctx.stroke() }
  ctx.globalAlpha = 0.6; ctx.strokeStyle = seam; ctx.lineWidth = 2
  for (let y = 0; y < size; y += size / 4) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke() }
  ctx.globalAlpha = 1
  return toTexture(device, c, 'wood')
}
/** Carpet: two-tone check with speckle. */
export function carpetTex(device: GraphicsDevice, a: string, b: string, size = 64, seed = 23): Texture {
  const [c, ctx] = canvas(size, size), r = rng(seed)
  for (let y = 0; y < size; y += 8) for (let x = 0; x < size; x += 8) { ctx.fillStyle = ((x + y) / 8) % 2 ? a : b; ctx.fillRect(x, y, 8, 8) }
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < size * size * 0.06; i++) { ctx.globalAlpha = 0.05 + r() * 0.1; ctx.fillRect(Math.floor(r() * size), Math.floor(r() * size), 1, 1) }
  ctx.globalAlpha = 1
  return toTexture(device, c, 'carpet')
}
/** Wall panels: rectangles with darker grout lines. */
export function panelTex(device: GraphicsDevice, base: string, grout: string, size = 64): Texture {
  const [c, ctx] = canvas(size, size)
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = grout; ctx.lineWidth = 2
  for (let y = 0; y <= size; y += size / 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke() }
  for (let row = 0; row < 2; row++) for (let x = row ? size / 4 : 0; x <= size; x += size / 2) { ctx.beginPath(); ctx.moveTo(x, row * size / 2); ctx.lineTo(x, (row + 1) * size / 2); ctx.stroke() }
  return toTexture(device, c, 'panel')
}
/** Grass: short vertical blade strokes over a base. */
export function grassTex(device: GraphicsDevice, base: string, blade: string, size = 64, seed = 31): Texture {
  const [c, ctx] = canvas(size, size), r = rng(seed)
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = blade; ctx.lineWidth = 1
  for (let i = 0; i < 260; i++) { ctx.globalAlpha = 0.25 + r() * 0.4; const x = r() * size, y = r() * size; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 2, y - 2 - r() * 3); ctx.stroke() }
  ctx.globalAlpha = 1
  return toTexture(device, c, 'grass')
}

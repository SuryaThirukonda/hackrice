import { EnvLighting, PIXELFORMAT_RGBA8, TEXTUREPROJECTION_CUBE, Texture, type GraphicsDevice } from 'playcanvas'

export interface SkyGradient { top: string; horizon: string; ground: string; sun?: { x: number; y: number; color: string } }

/** Paint six gradient faces into a cubemap: dark top, warm horizon band, darker ground. Nothing is downloaded. */
export function gradientCubemap(device: GraphicsDevice, g: SkyGradient, size = 64): Texture {
  const faces: HTMLCanvasElement[] = []
  // face order: +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    const c = document.createElement('canvas'); c.width = size; c.height = size
    const ctx = c.getContext('2d')!
    if (f === 2) { ctx.fillStyle = g.top; ctx.fillRect(0, 0, size, size) }
    else if (f === 3) { ctx.fillStyle = g.ground; ctx.fillRect(0, 0, size, size) }
    else {
      const grad = ctx.createLinearGradient(0, 0, 0, size)
      grad.addColorStop(0, g.top); grad.addColorStop(0.55, g.horizon); grad.addColorStop(0.62, g.horizon); grad.addColorStop(1, g.ground)
      ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size)
      if (g.sun && f === 4) { const r = ctx.createRadialGradient(g.sun.x * size, g.sun.y * size, 2, g.sun.x * size, g.sun.y * size, size * 0.35); r.addColorStop(0, g.sun.color); r.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, size, size) }
    }
    faces.push(c)
  }
  const tex = new Texture(device, { cubemap: true, width: size, height: size, format: PIXELFORMAT_RGBA8, mipmaps: true, projection: TEXTUREPROJECTION_CUBE, name: 'sky-src' })
  tex.setSource(faces)
  return tex
}

/** Build the environment atlas (ambient + reflections) from a gradient. The visible sky stays a per-world dome so the Phaser layer shows through. */
export function envAtlasFromGradient(device: GraphicsDevice, g: SkyGradient): Texture {
  const src = gradientCubemap(device, g)
  const lighting = EnvLighting.generateLightingSource(src, { size: 128 })
  const atlas = EnvLighting.generateAtlas(lighting, { size: 512 })
  lighting.destroy()
  return atlas
}

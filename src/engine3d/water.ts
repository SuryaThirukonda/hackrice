import { Texture, type GraphicsDevice } from 'playcanvas'

/** Seamless capillary waves: color variation plus a moving normal field, no physics. */
export function waterTextures(device: GraphicsDevice): { color: Texture; normal: Texture } {
  const size = 256, color = document.createElement('canvas'), normal = document.createElement('canvas')
  color.width = normal.width = size; color.height = normal.height = size
  const cc = color.getContext('2d')!, nc = normal.getContext('2d')!
  const pixels = cc.createImageData(size, size), normals = nc.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2
    const phase = v * 6 + Math.sin(u * 2) * 0.8
    const wave = Math.sin(phase) * 0.5 + Math.sin(u * 3 + v * 9) * 0.22
    const glint = Math.pow(Math.max(0, Math.cos(phase)), 18) * 28
    const k = (y * size + x) * 4
    pixels.data.set([135 + wave * 24 + glint, 177 + wave * 20 + glint, 182 + wave * 18 + glint, 255], k)
    normals.data.set([128 + Math.cos(u * 3 + v * 9) * 14, 128 + Math.cos(phase) * 24, 250, 255], k)
  }
  cc.putImageData(pixels, 0, 0); nc.putImageData(normals, 0, 0)
  const make = (canvas: HTMLCanvasElement, name: string) => {
    const texture = new Texture(device, { name, width: size, height: size, mipmaps: true, anisotropy: 8 })
    texture.setSource(canvas); return texture
  }
  return { color: make(color, 'water-ripples'), normal: make(normal, 'water-wave-normals') }
}

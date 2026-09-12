import { surfaceAt } from '../games/golf/sim/holes'
import type { Hole, Surface } from '../games/golf/sim/types'

const SURFACE_CODE: Record<Surface, number> = { ob: 0, rough: 1, fairway: 2, green: 3, bunker: 4, water: 5 }

export interface Mode7Palette { ob: string; rough: string; fairway: string; green: string; bunker: string; water: string }
export interface Mode7Camera { x: number; z: number; y: number; heading: number }

/** One-metre top-down surface raster. It is rebuilt only when the hole changes. */
export class CourseRaster {
  readonly minX: number
  readonly minZ: number
  readonly width: number
  readonly height: number
  readonly cells: Uint8Array

  constructor(hole: Hole) {
    const xs = hole.course.map((p) => p.x), zs = hole.course.map((p) => p.z)
    this.minX = Math.floor(Math.min(...xs)) - 20
    this.minZ = Math.floor(Math.min(...zs)) - 20
    this.width = Math.ceil(Math.max(...xs)) - this.minX + 21
    this.height = Math.ceil(Math.max(...zs)) - this.minZ + 21
    this.cells = new Uint8Array(this.width * this.height)
    for (let z = 0; z < this.height; z++) for (let x = 0; x < this.width; x++) {
      this.cells[z * this.width + x] = SURFACE_CODE[surfaceAt(hole, { x: this.minX + x + 0.5, z: this.minZ + z + 0.5 })]
    }
  }

  sample(x: number, z: number): number {
    const ix = Math.floor(x - this.minX), iz = Math.floor(z - this.minZ)
    return ix < 0 || iz < 0 || ix >= this.width || iz >= this.height ? 0 : this.cells[iz * this.width + ix]
  }
}

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Draw a moving pseudo-3D ground plane directly into the 384x216 stage. */
export function drawMode7(c: CanvasRenderingContext2D, map: CourseRaster, camera: Mode7Camera, palette: Mode7Palette, horizon = 86): void {
  const colors = [palette.ob, palette.rough, palette.fairway, palette.green, palette.bunker, palette.water].map(rgb)
  const h = 216 - horizon, frame = c.createImageData(384, h), out = frame.data
  const a = camera.heading * Math.PI / 180, fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a)
  const focal = 122
  for (let sy = 0; sy < h; sy++) {
    const row = sy + horizon
    const dist = Math.min(650, camera.y * focal / Math.max(1, row - horizon))
    const step = dist / focal
    const baseX = camera.x + fx * dist - rx * 192 * step
    const baseZ = camera.z + fz * dist - rz * 192 * step
    for (let sx = 0; sx < 384; sx++) {
      const wx = baseX + rx * sx * step, wz = baseZ + rz * sx * step
      const code = map.sample(wx, wz), col = colors[code]
      const stripe = code === 2 && ((Math.floor(wz / 16) + Math.floor(wx / 12)) & 1) === 0 ? 1.08 : 1
      const i = (sy * 384 + sx) * 4
      out[i] = Math.min(255, col[0] * stripe); out[i + 1] = Math.min(255, col[1] * stripe); out[i + 2] = Math.min(255, col[2] * stripe); out[i + 3] = 255
    }
  }
  c.putImageData(frame, 0, horizon)
}

/** Perspective lane floor used while the chase camera advances with the bowling ball. */
export function drawLaneGround(c: CanvasRenderingContext2D, cameraX: number, cameraZ: number, horizon = 86): void {
  const h = 216 - horizon, frame = c.createImageData(384, h), out = frame.data, focal = 128, cameraY = 1.25
  const woodA: [number, number, number] = [230, 166, 75], woodB: [number, number, number] = [246, 190, 92]
  const gutter: [number, number, number] = [32, 46, 78], deck: [number, number, number] = [12, 20, 42]
  for (let sy = 0; sy < h; sy++) {
    const row = sy + horizon, dist = Math.min(30, cameraY * focal / Math.max(1, row - horizon)), wz = cameraZ + dist
    const step = dist / focal
    for (let sx = 0; sx < 384; sx++) {
      const wx = cameraX + (sx - 192) * step
      let col = deck
      if (wz <= 20.1) {
        if (Math.abs(wx) <= 0.525) col = (Math.floor((wx + 0.525) / 0.105) & 1) ? woodA : woodB
        else if (Math.abs(wx) <= 0.78) col = gutter
      }
      const i = (sy * 384 + sx) * 4
      out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2]; out[i + 3] = 255
    }
  }
  c.putImageData(frame, 0, horizon)
}

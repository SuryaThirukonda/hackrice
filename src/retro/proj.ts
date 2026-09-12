export interface Projected { x: number; y: number; scale: number; visible: boolean }

/** Perspective projection for the lane. z is metres from the foul line. */
export function projectLane(x: number, z: number, cameraZ = -1): Projected {
  const rel = z - cameraZ
  const depth = Math.max(0, Math.min(1, rel / 20.5))
  const inv = 1 - depth
  const laneHalf = 146 * inv + 17
  return { x: 192 + (x / 0.76) * laneHalf, y: 199 - depth * 105, scale: 0.18 + inv * 1.12, visible: rel >= -0.5 && rel <= 21 }
}

/** Camera-relative projection used by the golf ball, trail and billboards. */
export function projectGolf(point: { x: number; y: number; z: number }, camera: { x: number; y: number; z: number; heading: number }): Projected {
  const a = camera.heading * Math.PI / 180
  const dx = point.x - camera.x, dz = point.z - camera.z
  const side = dx * Math.cos(a) - dz * Math.sin(a)
  const forward = dx * Math.sin(a) + dz * Math.cos(a)
  if (forward <= 0.35) return { x: 0, y: 0, scale: 0, visible: false }
  const focal = 118
  const scale = Math.max(0.06, Math.min(2.2, focal / forward))
  return { x: 192 + side * scale, y: 86 + (camera.y - point.y) * scale, scale, visible: Math.abs(side * scale) < 260 }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Critically damped springs for smooth pose following. */
export class Spring {
  x: number; v = 0; k: number
  constructor(x = 0, k = 20) { this.x = x; this.k = k }
  to(target: number, dt: number): number {
    const w = Math.sqrt(this.k)
    const a = this.k * (target - this.x) - 2 * w * this.v
    this.v += a * dt; this.x += this.v * dt
    return this.x
  }
  set(x: number): void { this.x = x; this.v = 0 }
}
export class Spring3 {
  x: Spring; y: Spring; z: Spring
  constructor(k = 20) { this.x = new Spring(0, k); this.y = new Spring(0, k); this.z = new Spring(0, k) }
  to(t: { x: number; y: number; z: number }, dt: number): { x: number; y: number; z: number } { return { x: this.x.to(t.x, dt), y: this.y.to(t.y, dt), z: this.z.to(t.z, dt) } }
  set(t: { x: number; y: number; z: number }): void { this.x.set(t.x); this.y.set(t.y); this.z.set(t.z) }
  get(): { x: number; y: number; z: number } { return { x: this.x.x, y: this.y.x, z: this.z.x } }
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t))
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export interface V3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
export const bezier2 = (p0: V3, p1: V3, p2: V3, u: number): V3 => {
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y, z: a * p0.z + b * p1.z + c * p2.z }
}

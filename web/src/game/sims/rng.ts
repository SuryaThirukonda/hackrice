// Seeded RNG (mulberry32) with a draw counter, shared by every sim so matches replay from a seed + input log.
export class Rng {
  private s: number
  draws = 0
  constructor(seed: number) { this.s = (seed >>> 0) || 1 }
  next(): number {
    this.draws++
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number { return a + (b - a) * this.next() }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)) }
  gauss(mean: number, sigma: number): number {
    const u = 1 - this.next(), v = this.next()
    return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  choice<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)] }
}

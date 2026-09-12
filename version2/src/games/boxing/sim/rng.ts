/** Deterministic mulberry32 RNG. Same seed, same draw order, same numbers. */
export class Rng {
  private s: number
  draws = 0
  constructor(seed: number) { this.s = seed >>> 0 }
  next(): number {
    this.draws++
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number { return a + (b - a) * this.next() }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)) }
  choice<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)] }
}

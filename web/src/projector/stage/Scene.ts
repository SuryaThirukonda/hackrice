import type { Application, Container } from 'pixi.js'

export interface Tick { [k: string]: unknown; who?: string; flags?: { shake?: boolean; hitstop?: boolean; slowmo?: boolean; gutter?: boolean }; anim_s?: number }

/** A scene never simulates; it renders match.tick summaries and phase changes from the server. */
export interface Scene {
  mount(app: Application, root: Container, size: { w: number; h: number }): void
  resize(size: { w: number; h: number }): void
  update(dtMs: number): void
  onTick(tick: Tick): void
  onPhase(phase: { phase: string; prompt?: Record<string, unknown>; turn_no: number } | null): void
  onMatch(match: Record<string, unknown> | null): void
  unmount(): void
}

export interface Effects { shake(strength: number): void; hitstop(ms: number): void; slowmo(factor: number, ms: number): void }

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

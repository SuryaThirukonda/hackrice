import type { Entity, StandardMaterial } from 'playcanvas'
import { flatMat, unlitMat } from '../../../engine3d/materials'
import { part, pivot } from '../../../engine3d/primitives'
import { P } from '../../../theme'
import type { Prop, Theme } from '../sim/types'

/** Colours (hex) and fog for one course theme. Meadow mirrors the original course look exactly. */
export interface ThemePalette {
  rough: number; course: number; fairway: number; green: number; sand: number; water: number; trunk: number; canopy: number
  skyTop: number; skyMid: number; skyHorizon: number
  /** Sun disc: compass azimuth (deg, 0 = north) and altitude (deg); absent for night themes. */
  sun?: { az: number; alt: number; color: string }
  clouds: boolean
  fog: { color: number; start: number; end: number }
}

export const THEMES: Record<Theme, ThemePalette> = {
  meadow: {
    rough: 0x2f7d3a, course: 0x45a04f, fairway: 0x7ed957, green: 0xa8f06a, sand: 0xf1dfb8, water: 0x2ad4ff, trunk: 0x8a5a2b, canopy: 0x2e8b45,
    skyTop: 0x2f86dc, skyMid: 0x6fbdf5, skyHorizon: 0xffe9c2, sun: { az: 40, alt: 28, color: '#fff2c0' }, clouds: true, fog: { color: 0xdcecf4, start: 60, end: 700 },
  },
  canyon: {
    rough: 0xb8743a, course: 0xd49a55, fairway: 0x9fbf4a, green: 0xbfe86a, sand: 0xf5d9a0, water: 0x3ab8d8, trunk: 0x6f4a2a, canopy: 0x5f8f3a,
    skyTop: 0xff8a3a, skyMid: 0xffc27a, skyHorizon: 0xffe6b8, sun: { az: 320, alt: 12, color: '#fff0c8' }, clouds: true, fog: { color: 0xf6d6a8, start: 60, end: 650 },
  },
  neon: {
    rough: 0x141a3a, course: 0x22306a, fairway: 0x3e5fd0, green: 0x63f0c8, sand: 0xd8c8ff, water: 0x4ff6ff, trunk: 0x2c2450, canopy: 0x36d6a0,
    skyTop: 0x06061c, skyMid: 0x1d1550, skyHorizon: 0x4a1f7a, clouds: false, fog: { color: 0x2a1a50, start: 60, end: 600 },
  },
}

/** Materials the prop builders share; created lazily on first use so importing this module has no GPU cost. */
let propMats: Record<'rock' | 'rockDark' | 'boulder' | 'cactus' | 'cactusDark' | 'palmTrunk' | 'frond' | 'tower' | 'magenta' | 'cyan' | 'lampPole' | 'bulb', StandardMaterial> | null = null
function mats() {
  return (propMats ??= {
    rock: flatMat(0xa07a5a), rockDark: flatMat(0x8a6244), boulder: flatMat(0xb08a68), cactus: flatMat(0x4f9a3f), cactusDark: flatMat(0x3f7f33),
    palmTrunk: flatMat(0x7a5a3a), frond: flatMat(0x39c27a), tower: flatMat(0x2a2a48), magenta: unlitMat(P.magenta), cyan: unlitMat(P.cyan),
    lampPole: flatMat(0x3a3a4a), bulb: unlitMat(0xfff2a8),
  })
}

const V = (x: number, y: number, z: number) => ({ x, y, z })

/** Two or three overlapping spheres, low and wide, with the shared ink outline. */
function rock(parent: Entity, s: number): void {
  const m = mats()
  part(parent, 'rock', 'sphere', m.rock, { pos: V(0, 0.55 * s, 0), scale: V(2.2 * s, 1.3 * s, 1.8 * s), outlineK: 0.06 })
  part(parent, 'rock', 'sphere', m.rockDark, { pos: V(0.9 * s, 0.4 * s, 0.5 * s), scale: V(1.3 * s, 0.9 * s, 1.2 * s), outlineK: 0.05 })
  part(parent, 'rock', 'sphere', m.rock, { pos: V(-0.8 * s, 0.35 * s, -0.4 * s), scale: V(1.1 * s, 0.7 * s, 1.0 * s), outlineK: 0.05 })
}
/** A tall stack of boxes and a sphere, tilted a little, for canyon walls. */
function boulder(parent: Entity, s: number): void {
  const m = mats()
  part(parent, 'boulder', 'box', m.boulder, { pos: V(0, 1.6 * s, 0), scale: V(3.2 * s, 3.2 * s, 2.6 * s), euler: V(0, 18, 4), outlineK: 0.08 })
  part(parent, 'boulder', 'box', m.rockDark, { pos: V(0.6 * s, 3.4 * s, -0.3 * s), scale: V(2.2 * s, 1.6 * s, 2.0 * s), euler: V(0, -12, -6), outlineK: 0.07 })
  part(parent, 'boulder', 'sphere', m.rock, { pos: V(-1.3 * s, 0.7 * s, 1.0 * s), scale: V(1.8 * s, 1.4 * s, 1.6 * s), outlineK: 0.06 })
}
/** Saguaro: a trunk and two arms that turn up. */
function cactus(parent: Entity, s: number): void {
  const m = mats()
  part(parent, 'cactus', 'cylinder', m.cactus, { pos: V(0, 2.0 * s, 0), scale: V(0.8 * s, 4.0 * s, 0.8 * s), outlineK: 0.06 })
  part(parent, 'cactusTop', 'sphere', m.cactus, { pos: V(0, 4.0 * s, 0), scale: V(0.8 * s, 0.8 * s, 0.8 * s), outlineK: 0.05 })
  for (const [dx, h] of [[1, 2.2], [-1, 1.6]] as const) {
    part(parent, 'arm', 'cylinder', m.cactusDark, { pos: V(dx * 0.75 * s, h * s, 0), scale: V(0.5 * s, 1.0 * s, 0.5 * s), euler: V(0, 0, 90), outlineK: 0.05 })
    part(parent, 'arm', 'cylinder', m.cactus, { pos: V(dx * 1.15 * s, (h + 0.7) * s, 0), scale: V(0.5 * s, 1.6 * s, 0.5 * s), outlineK: 0.05 })
    part(parent, 'armTop', 'sphere', m.cactus, { pos: V(dx * 1.15 * s, (h + 1.5) * s, 0), scale: V(0.5 * s, 0.5 * s, 0.5 * s), outlineK: 0.04 })
  }
}
/** Leaning trunk and five flat cones splayed from the crown. */
function palm(parent: Entity, s: number): void {
  const m = mats()
  part(parent, 'palmTrunk', 'cylinder', m.palmTrunk, { pos: V(0.3 * s, 3.5 * s, 0), scale: V(0.5 * s, 7 * s, 0.5 * s), euler: V(0, 0, -5), outlineK: 0.06 })
  const crown = pivot(parent, 'crown', V(0.6 * s, 7.0 * s, 0))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 360
    const arm = pivot(crown, 'frondPivot')
    arm.setLocalEulerAngles(0, a, 0)
    part(arm, 'frond', 'cone', m.frond, { pos: V(0, 0.2 * s, 1.6 * s), scale: V(1.4 * s, 3.6 * s, 0.25 * s), euler: V(115, 0, 0), outlineK: 0.05 })
  }
}
/** Tall dark block with unlit magenta and cyan strips up the sides and a glowing lamp on top. */
function tower(parent: Entity, s: number): void {
  const m = mats()
  const h = 22 * s
  part(parent, 'tower', 'box', m.tower, { pos: V(0, h / 2, 0), scale: V(4 * s, h, 4 * s), outlineK: 0.1 })
  for (let i = 0; i < 4; i++) {
    const a = i * 90, dx = Math.sin(a * Math.PI / 180) * 2.05 * s, dz = Math.cos(a * Math.PI / 180) * 2.05 * s
    part(parent, 'strip', 'box', i % 2 ? m.magenta : m.cyan, { pos: V(dx, h * 0.5, dz), scale: V(i % 2 ? 0.3 * s : 0.12 * s, h * 0.86, i % 2 ? 0.12 * s : 0.3 * s), euler: V(0, a, 0), outline: false })
  }
  for (let k = 1; k <= 3; k++) part(parent, 'band', 'box', k % 2 ? m.cyan : m.magenta, { pos: V(0, h * k / 4, 0), scale: V(4.3 * s, 0.25 * s, 4.3 * s), outline: false })
  part(parent, 'mast', 'cylinder', m.lampPole, { pos: V(0, h + 1.5 * s, 0), scale: V(0.3 * s, 3 * s, 0.3 * s), outline: false })
  part(parent, 'lamp', 'sphere', m.magenta, { pos: V(0, h + 3.4 * s, 0), scale: V(1.6 * s, 1.6 * s, 1.6 * s), outlineK: 0.06 })
}
/** Street lamp: a pole, a short arm and an unlit bulb. */
function lamp(parent: Entity, s: number): void {
  const m = mats()
  part(parent, 'lampPole', 'cylinder', m.lampPole, { pos: V(0, 2.5 * s, 0), scale: V(0.18 * s, 5 * s, 0.18 * s), outlineK: 0.04 })
  part(parent, 'lampArm', 'box', m.lampPole, { pos: V(0.45 * s, 4.95 * s, 0), scale: V(1.0 * s, 0.14 * s, 0.14 * s), outlineK: 0.03 })
  part(parent, 'bulb', 'sphere', m.bulb, { pos: V(0.9 * s, 4.75 * s, 0), scale: V(0.55 * s, 0.55 * s, 0.55 * s), outlineK: 0.04 })
}

const BUILDERS: Record<Prop['kind'], (parent: Entity, s: number) => void> = { rock, boulder, cactus, palm, tower, lamp }

/**
 * Build one prop under `parent` at the given render-space position (the caller applies the x mirror).
 * Returns the pivot so the scene can destroy it with the hole.
 */
export function buildProp(parent: Entity, prop: Prop, x: number, y: number, z: number): Entity {
  const e = pivot(parent, `prop:${prop.kind}`, V(x, y, z))
  e.setLocalEulerAngles(0, (prop.p.x * 37 + prop.p.z * 11) % 360, 0) // deterministic per-prop yaw so rows of props do not look stamped
  BUILDERS[prop.kind](e, prop.s ?? 1)
  return e
}

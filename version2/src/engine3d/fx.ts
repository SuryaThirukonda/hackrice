import { BLEND_ADDITIVE, BLEND_NORMAL, Curve, CurveSet, EMITTERSHAPE_SPHERE, Entity } from 'playcanvas'

export type FxKind = 'sweat' | 'dust' | 'sparks' | 'confetti' | 'splash' | 'grass' | 'pinSpark'
const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const colorSet = (a: number, b: number): CurveSet => { const A = rgb(a), B = rgb(b); return new CurveSet([[0, A[0], 1, B[0]], [0, A[1], 1, B[1]], [0, A[2], 1, B[2]]]) }

/** One-shot particle bursts built from engine primitives (no textures needed: the emitter's default soft spot is used). */
export class Fx {
  private pool = new Map<FxKind, Entity[]>()
  private root: Entity
  constructor(root: Entity) { this.root = root }

  private make(kind: FxKind): Entity {
    const e = new Entity('fx:' + kind)
    const base = { loop: false, autoPlay: false, localSpace: false, lighting: false, emitterShape: EMITTERSHAPE_SPHERE, alignToMotion: false, startAngle: 0, startAngle2: 360, depthWrite: false, depthSoftening: 0 }
    const presets: Record<FxKind, Record<string, unknown>> = {
      sweat: { ...base, numParticles: 28, lifetime: 0.45, rate: 0.001, rate2: 0.002, emitterRadius: 0.05, initialVelocity: 3.2, blendType: BLEND_NORMAL, scaleGraph: new Curve([0, 0.05, 1, 0.01]), alphaGraph: new Curve([0, 1, 1, 0]), colorGraph: colorSet(0xffffff, 0xbfe8ff), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, -4, 1, -9], [0, 0, 1, 0]]) },
      dust: { ...base, numParticles: 40, lifetime: 1.1, rate: 0.002, rate2: 0.004, emitterRadius: 0.35, initialVelocity: 1.2, blendType: BLEND_NORMAL, scaleGraph: new Curve([0, 0.2, 1, 0.9]), alphaGraph: new Curve([0, 0.55, 1, 0]), colorGraph: colorSet(0xd9c9a8, 0xa89a80), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, 0.6, 1, 0.1], [0, 0, 1, 0]]) },
      sparks: { ...base, numParticles: 40, lifetime: 0.5, rate: 0.001, rate2: 0.002, emitterRadius: 0.05, initialVelocity: 5, blendType: BLEND_ADDITIVE, scaleGraph: new Curve([0, 0.08, 1, 0.0]), alphaGraph: new Curve([0, 1, 1, 0]), colorGraph: colorSet(0xffe066, 0xff4d1a), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, 0, 1, -9], [0, 0, 1, 0]]) },
      confetti: { ...base, numParticles: 120, lifetime: 2.6, rate: 0.004, rate2: 0.01, emitterRadius: 0.4, initialVelocity: 5, blendType: BLEND_NORMAL, scaleGraph: new Curve([0, 0.07, 1, 0.07]), alphaGraph: new Curve([0, 1, 0.8, 1, 1, 0]), colorGraph: colorSet(0xff3a3a, 0x2f6cf6), rotationSpeedGraph: new Curve([0, 220, 1, 90]), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, 1.5, 1, -2.5], [0, 0, 1, 0]]) },
      splash: { ...base, numParticles: 50, lifetime: 0.8, rate: 0.001, rate2: 0.003, emitterRadius: 0.2, initialVelocity: 4, blendType: BLEND_NORMAL, scaleGraph: new Curve([0, 0.12, 1, 0.02]), alphaGraph: new Curve([0, 1, 1, 0]), colorGraph: colorSet(0xbfe8ff, 0x2ad4ff), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, 3, 1, -8], [0, 0, 1, 0]]) },
      grass: { ...base, numParticles: 24, lifetime: 0.7, rate: 0.001, rate2: 0.003, emitterRadius: 0.1, initialVelocity: 2.5, blendType: BLEND_NORMAL, scaleGraph: new Curve([0, 0.06, 1, 0.02]), alphaGraph: new Curve([0, 1, 1, 0]), colorGraph: colorSet(0x7ed957, 0x2e8b45), velocityGraph: new CurveSet([[0, 0, 1, 0], [0, 2, 1, -7], [0, 0, 1, 0]]) },
      pinSpark: { ...base, numParticles: 18, lifetime: 0.35, rate: 0.001, rate2: 0.002, emitterRadius: 0.06, initialVelocity: 2.5, blendType: BLEND_ADDITIVE, scaleGraph: new Curve([0, 0.06, 1, 0]), alphaGraph: new Curve([0, 1, 1, 0]), colorGraph: colorSet(0xffffff, 0xffd50a) },
    }
    e.addComponent('particlesystem', presets[kind])
    this.root.addChild(e)
    return e
  }
  /** Fire a burst at a world position. Emitters are pooled per kind (up to 4 concurrent). */
  burst(kind: FxKind, x: number, y: number, z: number): void {
    const list = this.pool.get(kind) ?? []
    let e = list.find((p) => !p.particlesystem?.isPlaying())
    if (!e) { if (list.length >= 4) e = list[0]; else { e = this.make(kind); list.push(e); this.pool.set(kind, list) } }
    e.setPosition(x, y, z)
    const ps = e.particlesystem!
    ps.reset(); ps.play()
  }
}

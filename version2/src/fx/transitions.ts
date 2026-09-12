// Comic wipe between scenes: a diagonal ink panel sweeps across, the next scene starts underneath, the panel sweeps away.
import Phaser from 'phaser'
import { P } from '../theme'
import { sfx } from './sfx'

let busy = false
let safety: ReturnType<typeof setTimeout> | undefined
export const isWiping = (): boolean => busy
export function wipeTo(scene: Phaser.Scene, target: string, data: Record<string, unknown> = {}): void {
  if (busy || !scene.scene.isActive()) return
  busy = true
  clearTimeout(safety)
  safety = setTimeout(() => { busy = false }, 2500) // never leave navigation dead if a target scene fails to report created
  sfx.wipe()
  const { width: W, height: H } = scene.scale
  const g = scene.add.graphics().setDepth(10_000).setScrollFactor(0)
  const cover = { x: -W * 1.4 }
  const draw = () => {
    g.clear()
    g.fillStyle(P.ink).fillPoints([{ x: cover.x, y: 0 }, { x: cover.x + W * 1.2, y: 0 }, { x: cover.x + W * 0.9, y: H }, { x: cover.x - W * 0.3, y: H }], true)
    g.lineStyle(14, P.gold).lineBetween(cover.x + W * 1.2, 0, cover.x + W * 0.9, H)
    g.lineStyle(14, P.red).lineBetween(cover.x, 0, cover.x - W * 0.3, H)
  }
  scene.tweens.add({ targets: cover, x: 0, duration: 320, ease: 'Cubic.In', onUpdate: draw, onComplete: () => {
    scene.scene.start(target, data)
    const next = scene.scene.get(target)
    next.events.once(Phaser.Scenes.Events.CREATE, () => {
      const g2 = next.add.graphics().setDepth(10_000).setScrollFactor(0)
      const c2 = { x: 0 }
      const draw2 = () => { g2.clear(); g2.fillStyle(P.ink).fillPoints([{ x: c2.x, y: 0 }, { x: c2.x + W * 1.2, y: 0 }, { x: c2.x + W * 0.9, y: H }, { x: c2.x - W * 0.3, y: H }], true); g2.lineStyle(14, P.gold).lineBetween(c2.x + W * 1.2, 0, c2.x + W * 0.9, H) }
      draw2()
      next.tweens.add({ targets: c2, x: W * 1.5, duration: 380, ease: 'Cubic.Out', onUpdate: draw2, onComplete: () => { g2.destroy(); busy = false; clearTimeout(safety) } })
    })
  } })
}

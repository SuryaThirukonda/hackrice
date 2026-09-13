import Phaser from 'phaser'
import { DISPLAY, HEX, P } from '../theme'
import { formatActive } from './energy'
import type { HealthTracker } from './tracker'

/**
 * A small comic chip under the HUD that counts the match's calories, swings and active time as they
 * happen, so the number climbs with every swing rather than appearing once at the end. Only drawn once
 * the phone has reported movement; a keyboard match never shows it.
 */
export function healthBadge(scene: Phaser.Scene, tracker: HealthTracker, x: number, y: number): { update: () => void; destroy: () => void } {
  const g = scene.add.graphics().setDepth(104).setVisible(false)
  const t = scene.add.text(x, y, '', { fontFamily: DISPLAY, fontSize: '16px', color: HEX(P.ink) }).setOrigin(0, 0.5).setDepth(105).setVisible(false)
  let last = '', lastAt = 0
  const update = (): void => {
    const now = scene.time.now
    if (now - lastAt < 500) return
    lastAt = now
    const live = tracker.live()
    if (!live.moving) return
    const text = `~${Math.round(live.kcal)} kcal  ·  ${live.swings} swing${live.swings === 1 ? '' : 's'}  ·  ${formatActive(live.activeSeconds)} active`
    if (text === last) return
    last = text
    t.setText(text).setVisible(true)
    const w = t.width + 28, h = 30
    g.clear().setVisible(true)
      .fillStyle(P.ink, 0.9).fillRoundedRect(x - 14 + 4, y - h / 2 + 4, w, h, 10)
      .fillStyle(P.teal).fillRoundedRect(x - 14, y - h / 2, w, h, 10)
      .lineStyle(4, P.ink).strokeRoundedRect(x - 14, y - h / 2, w, h, 10)
  }
  return { update, destroy: () => { g.destroy(); t.destroy() } }
}

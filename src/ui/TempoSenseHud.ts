import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { sensingSession } from '../camera/sensingSession'
import { boxingOccupied, bowlingOccupied, golfOccupied, layoutDebugEnabled, placeOverlay, type SportHudMap } from './SafeArea'
import type { HealthSport } from '../health/energy'
import type { HealthTracker } from '../health/tracker'

/**
 * Compact TEMPO SENSE chip during play. Positioned via SafeArea so it never covers sport HUD.
 */
export function tempoSenseHud(
  scene: Phaser.Scene,
  sport: HealthSport,
  tracker: HealthTracker,
): { update: () => void; destroy: () => void; layout: (W: number, H: number) => void } {
  const root = scene.add.container(0, 0).setDepth(106)
  const g = scene.add.graphics()
  const title = scene.add.text(0, 0, 'TEMPO SENSE', { fontFamily: DISPLAY, fontSize: '13px', color: HEX(P.ink) })
  const line1 = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: HEX(P.ink), fontStyle: '900' })
  const line2 = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: HEX(P.ink), fontStyle: '900' })
  const line3 = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: HEX(P.ink), fontStyle: '900' })
  root.add([g, title, line1, line2, line3])
  let debug: Phaser.GameObjects.Graphics | null = null
  let last = ''
  let W = scene.scale.width, H = scene.scale.height
  const chip = { w: 168, h: 92 }

  const occupiedFor = (): SportHudMap => sport === 'boxing' ? boxingOccupied(W, H) : sport === 'bowling' ? bowlingOccupied(W, H) : golfOccupied(W, H)

  const layout = (width: number, height: number): void => {
    W = width; H = height
    const pos = placeOverlay(W, H, occupiedFor(), chip.w, chip.h)
    root.setPosition(pos.x, pos.y)
    if (layoutDebugEnabled()) {
      debug?.destroy()
      debug = scene.add.graphics().setDepth(200)
      const occ = occupiedFor()
      for (const r of Object.values(occ)) debug.fillStyle(0xff0000, 0.12).fillRect(r.x, r.y, r.w, r.h).lineStyle(1, 0xff0000, 0.5).strokeRect(r.x, r.y, r.w, r.h)
      debug.fillStyle(0x00ff88, 0.18).fillRect(pos.x, pos.y, chip.w, chip.h).lineStyle(2, 0x00ff88).strokeRect(pos.x, pos.y, chip.w, chip.h)
    }
  }

  const paint = (): void => {
    g.clear()
      .fillStyle(P.ink, 0.85).fillRoundedRect(4, 4, chip.w, chip.h, 12)
      .fillStyle(P.paper).fillRoundedRect(0, 0, chip.w, chip.h, 12)
      .lineStyle(3, P.ink).strokeRoundedRect(0, 0, chip.w, chip.h, 12)
    title.setPosition(12, 8)
    line1.setPosition(12, 28)
    line2.setPosition(12, 48)
    line3.setPosition(12, 68)
  }

  const update = (): void => {
    const live = tracker.live()
    const snap = sensingSession.snapshot
    const move = live.motionLoad >= 0.55 ? 'HIGH' : live.motionLoad >= 0.28 ? 'MID' : live.moving ? 'LOW' : '—'
    const cam = snap.phase === 'good' || snap.phase === 'warming' || snap.phase === 'preview' ? '● CAMERA' : snap.phase === 'off' ? '○ CAMERA' : '○ CAM ERR'
    const pulse = snap.pulseTier === 'trusted' && snap.pulse
      ? `♥  ${Math.round(snap.pulse)}`
      : snap.pulseTier === 'estimating' && snap.pulse
        ? `♥  ${Math.round(snap.pulse)} ~`
        : '♥  —'
    const expr = snap.dominantExpression && snap.facePresent ? `🙂  ${snap.dominantExpression.toUpperCase().slice(0, 8)}` : '🙂  —'
    const text = `${cam}|MOVE ${move}|${pulse}|${expr}`
    if (text === last) return
    last = text
    line1.setText(`${cam}   MOVE ${move}`)
    line2.setText(snap.pulseTier === 'estimating' ? `${pulse}  EST` : pulse)
    line3.setText(expr)
    paint()
  }

  layout(W, H)
  paint()
  return {
    update,
    layout,
    destroy: () => { root.destroy(); debug?.destroy() },
  }
}

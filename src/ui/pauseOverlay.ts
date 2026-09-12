import Phaser from 'phaser'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { ComicButton, comicPanel, MenuNav } from './widgets'
import { openControllerConnect } from '../scenes/ControllerScene'

export interface PauseRow { keys: string; label: string; hint: string }
export interface PauseAction { label: string; color: number; cb: () => void }

/** Comic pause menu shared by every game: key caps, labels, hints, and navigable buttons. Call destroy() to close. */
export function pauseOverlay(scene: Phaser.Scene, rows: PauseRow[], actions: PauseAction[], title = 'PAUSED'): { destroy: () => void } {
  const W = scene.scale.width, H = scene.scale.height
  const objs: Phaser.GameObjects.GameObject[] = []
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { objs.push(o); return o }
  const rowH = 44, pw = Math.min(860, W - 40)
  const twoCol = rows.length > 7
  const cols = twoCol ? 2 : 1
  const perCol = Math.ceil(rows.length / cols)
  const listH = perCol * rowH
  const ph = 110 + listH + 26 + 74
  const px = W / 2 - pw / 2, py = Math.max(16, H / 2 - ph / 2)
  add(scene.add.rectangle(0, 0, W, H, P.ink, 0.55).setOrigin(0).setDepth(130))
  add(comicPanel(scene, px, py, pw, ph, P.paper, 0.6).setDepth(131))
  add(scene.add.text(W / 2, py + 52, title, { fontFamily: DISPLAY, fontSize: '50px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5).setDepth(132))
  const colW = (pw - 40) / cols
  rows.forEach((r, i) => {
    const c = Math.floor(i / perCol), k = i % perCol
    const x0 = px + 20 + c * colW, y = py + 110 + k * rowH + rowH / 2
    const cap = add(new ComicButton(scene, x0 + 66, y, r.keys, () => undefined, { color: P.gold, w: 120, h: 32, size: 15 })).setDepth(133)
    cap.disableInteractive()
    add(scene.add.text(x0 + 140, y - 9, r.label, { fontFamily: DISPLAY, fontSize: '17px', color: HEX(P.ink) }).setOrigin(0, 0.5).setDepth(133))
    add(scene.add.text(x0 + 140, y + 10, r.hint, { fontFamily: FONT, fontSize: '12px', color: HEX(0x5a4632), fontStyle: '900', wordWrap: { width: colW - 150 } }).setOrigin(0, 0.5).setDepth(133))
  })
  // Every paused game offers the phone-connect screen, so a player who arrives late never has to quit
  // to the menu to join. It opens over the pause panel and resumes this scene when it closes.
  const all = [...actions, { label: 'CONNECT PHONE', color: P.magenta, cb: () => openControllerConnect(scene) }]
  const by = py + ph - 48
  const bw = Math.min(250, (pw - 60) / all.length - 14)
  const buttons = all.map((a, i) => add(new ComicButton(scene, W / 2 + (i - (all.length - 1) / 2) * (bw + 18), by, a.label, a.cb, { color: a.color, w: bw, h: 52, size: 22 })).setDepth(133))
  const nav = new MenuNav(scene, buttons, (i) => all[i].cb(), undefined, false) // Esc stays with the scene's own pause toggle
  return { destroy: () => { nav.dispose(); for (const o of objs) o.destroy() } }
}

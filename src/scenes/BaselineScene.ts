import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { bowlingParams, boxingParams, golfParams } from '../agent/sliders'

type Vitals = { status: string; source: 'camera' | 'demo' | null; guidance: string; validation: string; pulse: { value: number; at: number } | null; baselinePulse: number | null; mode?: 'live' | 'mock' | 'off' }
export class BaselineScene extends Phaser.Scene {
  private city!: ComicBackdrop; private state: 'consent' | 'connecting' | 'warming' | 'ready' | 'unavailable' = 'consent'; private vitals: Vitals | null = null; private content: Phaser.GameObjects.GameObject[] = []
  constructor() { super('baseline') }
  create(): void {
    ensureTextures(this); this.city = new ComicBackdrop(this, 82)
    const kb = this.input.keyboard!; kb.on('keydown-C', () => void this.enable(false)); kb.on('keydown-D', () => void this.enable(true)); kb.on('keydown-S', () => this.skip()); kb.on('keydown-ENTER', () => { if (this.state === 'ready') this.begin() }); kb.on('keydown-ESC', () => wipeTo(this, 'tempo-session'))
    this.time.addEvent({ delay: 1000, loop: true, callback: () => void this.poll() }); this.draw()
  }
  private async enable(demo: boolean): Promise<void> { this.state = 'connecting'; this.draw(); try { const r = await fetch('/vitals/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo }) }); this.vitals = await r.json() as Vitals; tempoFlow.physiologyMode = this.vitals.source === 'demo' ? 'mock' : 'live'; this.state = this.vitals.status === 'error' || this.vitals.status === 'unavailable' ? 'unavailable' : 'warming' } catch { this.state = 'unavailable' } this.draw() }
  private async poll(): Promise<void> { if (this.state !== 'warming' && this.state !== 'connecting') return; try { const r = await fetch('/vitals', { cache: 'no-store' }); if (!r.ok) return; this.vitals = await r.json() as Vitals; if (this.vitals.baselinePulse && this.vitals.pulse && Date.now() - this.vitals.pulse.at <= 5000 && this.vitals.validation === 'Ok') { tempoFlow.baselinePulse = this.vitals.baselinePulse; this.state = 'ready' } else this.state = this.vitals.status === 'error' || this.vitals.status === 'unavailable' ? 'unavailable' : 'warming'; this.draw() } catch { this.state = 'unavailable'; this.draw() } }
  private skip(): void {
    // A movement-only session should never wait for the camera gate. Stop an in-flight
    // camera request in the background, then enter the sport immediately.
    void fetch('/vitals/stop', { method: 'POST' }).catch(() => undefined)
    tempoFlow.physiologyMode = 'off'; tempoFlow.baselinePulse = null; this.begin()
  }
  private begin(): void { const sport = tempoFlow.nextSport(); if (!sport) return wipeTo(this, 'session-summary'); const d = tempoFlow.difficulty; const data = sport === 'boxing' ? { mode: '1p', bot: boxingParams(d), tempo: true } : sport === 'bowling' ? { mode: '1p', bot: bowlingParams(d), tempo: true } : { mode: '1p', bot: golfParams(d), tempo: true }; wipeTo(this, sport, data) }
  private draw(): void {
    this.content.forEach((o) => o.destroy()); this.content = []
    const { width: W, height: H } = this.scale, k = Math.min(W / 1280, H / 720), add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    add(comicPanel(this, W * .18, 40 * k, W * .64, H - 80 * k, P.paper, -.7, 1)); add(this.add.text(W / 2, 72 * k, 'TEMPO CHECK-IN', { fontFamily: DISPLAY, fontSize: `${Math.round(44 * k)}px`, color: HEX(P.ink) }).setOrigin(.5, 0))
    add(this.add.text(W / 2, 130 * k, 'Find your starting tempo.', { fontFamily: FONT, fontSize: `${Math.round(17 * k)}px`, color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(.5))
    const cx = W / 2, cy = 270 * k, person = add(this.add.graphics().setDepth(12)); person.lineStyle(7 * k, P.ink).fillStyle(P.blue, .16).fillCircle(cx, cy - 55 * k, 34 * k).strokeCircle(cx, cy - 55 * k, 34 * k).fillRoundedRect(cx - 62 * k, cy - 5 * k, 124 * k, 112 * k, 40 * k).strokeRoundedRect(cx - 62 * k, cy - 5 * k, 124 * k, 112 * k, 40 * k)
    const good = this.state === 'ready', waiting = this.state === 'connecting' || this.state === 'warming'
    const rows = [['CAMERA', this.state === 'consent' ? 'OFF' : this.state === 'unavailable' ? 'UNAVAILABLE' : 'READY'], ['POSITION', waiting ? 'CAMERA CHECK · OPTIONAL' : good ? 'GOOD' : '—'], ['SIGNAL', waiting ? 'WARMING UP' : good ? 'GOOD' : '—']]
    rows.forEach(([a, b], i) => { const y = 420 * k + i * 35 * k; add(this.add.text(W * .3, y, a, { fontFamily: DISPLAY, fontSize: `${Math.round(15 * k)}px`, color: HEX(P.ink) })); add(this.add.text(W * .7, y, b, { fontFamily: DISPLAY, fontSize: `${Math.round(15 * k)}px`, color: HEX(good ? P.green : waiting ? P.orange : P.red) }).setOrigin(1, 0)) })
    add(this.add.text(W / 2, 535 * k, good ? `${Math.round(tempoFlow.baselinePulse!)} BPM` : '—', { fontFamily: DISPLAY, fontSize: `${Math.round(42 * k)}px`, color: HEX(P.blue) }).setOrigin(.5)); add(this.add.text(W / 2, 578 * k, 'STARTING PULSE', { fontFamily: DISPLAY, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.blue) }).setOrigin(.5))
    if (this.state === 'consent') {
      add(this.add.text(W / 2, H - 132 * k, 'Camera is optional. Start immediately with movement data, or press C to enable sensing.', { fontFamily: FONT, fontSize: `${Math.round(11 * k)}px`, color: HEX(P.ink), fontStyle: '900', wordWrap: { width: W * .72 }, align: 'center' }).setOrigin(.5))
      add(new ComicButton(this, W * .38, H - 70 * k, 'ENABLE CAMERA', () => void this.enable(false), { color: P.blue, w: 260 * k, h: 54 * k, size: Math.round(19 * k) }))
      add(new ComicButton(this, W * .62, H - 70 * k, 'START NOW', () => this.skip(), { color: P.green, w: 230 * k, h: 54 * k, size: Math.round(19 * k) }))
    }
    else if (good) add(new ComicButton(this, W / 2, H - 72 * k, 'BEGIN SESSION', () => this.begin(), { color: P.green, w: 310 * k, h: 56 * k, size: Math.round(22 * k) }))
    else {
      add(this.add.text(W / 2, H - 132 * k, this.state === 'unavailable' ? 'Camera sensing unavailable. You can still play.' : 'Sensing can keep warming in the background while you play.', { fontFamily: FONT, fontSize: `${Math.round(11 * k)}px`, color: HEX(P.ink), fontStyle: '900', wordWrap: { width: W * .65 }, align: 'center' }).setOrigin(.5))
      add(new ComicButton(this, W / 2, H - 70 * k, 'START WITH MOVEMENT', () => this.skip(), { color: P.green, w: 350 * k, h: 54 * k, size: Math.round(19 * k) }))
    }
    add(this.add.text(W / 2, 166 * k, 'Camera starts only with your consent. No video or frames are stored.', { fontFamily: FONT, fontSize: `${Math.round(10 * k)}px`, color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(.5))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}

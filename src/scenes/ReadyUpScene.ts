import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { tempoFlow } from '../wellness/tempoFlow'
import { controllerInput } from '../input/controller'
import { controllerUrl, NO_LINK, resolveJoinLink, supportsMotion, type JoinLink } from '../input/joinLink'
import { bowlingParams, boxingParams, golfParams } from '../agent/sliders'
import { sensingSession } from '../camera/sensingSession'

/**
 * TEMPO READY-UP — phone + camera on one screen. Camera is optional; controller mode is required.
 * Live browser preview so the player never wonders whether the camera works.
 */
export class ReadyUpScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private items: Phaser.GameObjects.GameObject[] = []
  private link: JoinLink = NO_LINK
  private qrKey = 'ready-qr'
  private previewRect = new DOMRect(0, 0, 1, 1)
  private poll?: Phaser.Time.TimerEvent
  private host: HTMLElement | null = null
  private startingPlay = false

  constructor() { super('ready-up') }

  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 83)
    this.host = document.getElementById('game')
    this.startingPlay = false
    const kb = this.input.keyboard!
    kb.on('keydown-ESC', () => void this.leave())
    kb.on('keydown-ENTER', () => { if (tempoFlow.readyToStart) this.startPlay() })
    this.poll = this.time.addEvent({ delay: 400, loop: true, callback: () => this.draw() })
    void this.refreshLink()
    this.time.addEvent({ delay: 4000, loop: true, callback: () => void this.refreshLink() })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => void this.onShutdown())
    this.draw()
  }

  private async leave(): Promise<void> {
    this.startingPlay = false
    await sensingSession.stop()
    wipeTo(this, 'tempo-session')
  }

  private async onShutdown(): Promise<void> {
    this.poll?.remove(false)
    if (this.startingPlay && tempoFlow.cameraMode === 'live') sensingSession.continueIntoPlay()
    else if (!this.startingPlay) await sensingSession.stop()
  }

  private async refreshLink(): Promise<void> {
    this.link = await resolveJoinLink()
    if (this.link.origin) await this.ensureQr()
    if (this.scene.isActive()) this.draw()
  }

  private async ensureQr(): Promise<void> {
    const value = controllerUrl(this.link, 1)
    if (!value || this.textures.exists(this.qrKey)) return
    try {
      const QRCode = (await import('qrcode')).default
      const data = await QRCode.toDataURL(value, { width: 360, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141414', light: '#ffffff' } })
      await new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          if (!this.textures.exists(this.qrKey)) this.textures.addImage(this.qrKey, img)
          resolve()
        }
        img.onerror = () => resolve()
        img.src = data
      })
    } catch { /* QR optional */ }
  }

  private phoneConnected(): boolean { return controllerInput.connected('controller_1') }

  private async enableCamera(): Promise<void> {
    if (!this.host) return
    tempoFlow.cameraMode = 'live'
    await sensingSession.enable(this.host, this.previewRect)
    this.draw()
  }

  private async skipCamera(): Promise<void> {
    await sensingSession.stop()
    tempoFlow.cameraMode = 'skipped'
    tempoFlow.physiologyMode = 'off'
    tempoFlow.baselinePulse = null
    this.draw()
  }

  private async retryCamera(): Promise<void> {
    if (!this.host) return
    await sensingSession.retry(this.host, this.previewRect)
    this.draw()
  }

  private useKeyboard(): void {
    tempoFlow.controllerMode = 'keyboard'
    this.draw()
  }

  private usePhone(): void {
    tempoFlow.controllerMode = 'phone'
    this.draw()
  }

  private startPlay(): void {
    if (!tempoFlow.readyToStart) return
    if (tempoFlow.cameraMode === 'off') tempoFlow.cameraMode = 'skipped'
    const snap = sensingSession.snapshot
    if (tempoFlow.cameraMode === 'live') {
      tempoFlow.physiologyMode = snap.mock ? 'mock' : snap.mode === 'off' ? 'off' : 'live'
      tempoFlow.baselinePulse = snap.baselinePulse
    } else {
      void sensingSession.stop()
    }
    this.startingPlay = true
    const sport = tempoFlow.nextSport()
    if (!sport) return wipeTo(this, 'session-summary')
    const d = tempoFlow.difficulty
    const data = sport === 'boxing' ? { mode: '1p', bot: boxingParams(d), tempo: true }
      : sport === 'bowling' ? { mode: '1p', bot: bowlingParams(d), tempo: true }
        : { mode: '1p', bot: golfParams(d), tempo: true }
    wipeTo(this, sport, data)
  }

  private sportLabel(): string {
    const s = tempoFlow.selectedSport ?? tempoFlow.peekNextSport()
    return (s ?? 'TEMPO').toUpperCase()
  }

  private draw(): void {
    if (!this.scene.isActive()) return
    this.items.forEach((o) => o.destroy())
    this.items = []
    const { width: W, height: H } = this.scale
    const k = Math.min(W / 1280, H / 720)
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.items.push(o); return o }

    add(comicPanel(this, W * .06, 20 * k, W * .88, 70 * k, P.paper, -.5, 1))
    add(this.add.text(W / 2, 32 * k, 'TEMPO READY-UP', { fontFamily: DISPLAY, fontSize: `${Math.round(34 * k)}px`, color: HEX(P.ink) }).setOrigin(.5, 0))
    add(this.add.text(W / 2, 68 * k, `${this.sportLabel()}  ·  get set, then start playing`, {
      fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(0x5a4632), fontStyle: '900',
    }).setOrigin(.5))

    const gap = 16 * k
    const colW = (W * .88 - gap) / 2
    const leftX = W * .06
    const rightX = leftX + colW + gap
    const cardY = 108 * k
    const cardH = H - cardY - 120 * k

    // —— PHONE ——
    add(comicPanel(this, leftX, cardY, colW, cardH, P.paper, .4, 1))
    add(this.add.text(leftX + 22 * k, cardY + 18 * k, 'PHONE CONTROLLER', { fontFamily: DISPLAY, fontSize: `${Math.round(20 * k)}px`, color: HEX(P.magenta) }))
    const phoneOn = this.phoneConnected()
    if (phoneOn) {
      tempoFlow.controllerMode = tempoFlow.controllerMode ?? 'phone'
      add(this.add.text(leftX + 22 * k, cardY + 56 * k, '✓ CONNECTED', { fontFamily: DISPLAY, fontSize: `${Math.round(28 * k)}px`, color: HEX(P.green) }))
      add(this.add.text(leftX + 22 * k, cardY + 96 * k, 'Controller ready for movement tracking', {
        fontFamily: FONT, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.ink), fontStyle: '900', wordWrap: { width: colW - 44 * k },
      }))
    } else {
      add(this.add.text(leftX + 22 * k, cardY + 56 * k, 'Waiting for controller…', {
        fontFamily: FONT, fontSize: `${Math.round(14 * k)}px`, color: HEX(P.ink), fontStyle: '900',
      }))
      if (this.textures.exists(this.qrKey)) {
        const qrSize = Math.min(colW - 80 * k, cardH - 220 * k, 220 * k)
        add(this.add.image(leftX + colW / 2, cardY + 90 * k + qrSize / 2, this.qrKey).setDisplaySize(qrSize, qrSize).setDepth(12))
      } else {
        add(this.add.text(leftX + colW / 2, cardY + 160 * k, this.link.origin ? 'Loading QR…' : 'Start npm run agent / tunnel for QR', {
          fontFamily: FONT, fontSize: `${Math.round(12 * k)}px`, color: HEX(0x5a4632), fontStyle: '900', align: 'center', wordWrap: { width: colW - 40 * k },
        }).setOrigin(.5))
      }
      if (this.link.origin && !supportsMotion(this.link)) {
        add(this.add.text(leftX + 22 * k, cardY + cardH - 120 * k, 'LAN link: buttons only. Swings need HTTPS tunnel.', {
          fontFamily: FONT, fontSize: `${Math.round(11 * k)}px`, color: HEX(P.orange), fontStyle: '900', wordWrap: { width: colW - 44 * k },
        }))
      }
    }
    const phoneBtnY = cardY + cardH - 48 * k
    if (!phoneOn) {
      add(new ComicButton(this, leftX + colW * .32, phoneBtnY, 'USE KEYBOARD', () => this.useKeyboard(), {
        color: tempoFlow.controllerMode === 'keyboard' ? P.green : P.paper, w: colW * .4, h: 44 * k, size: Math.round(14 * k),
      }))
      add(new ComicButton(this, leftX + colW * .72, phoneBtnY, 'WAIT FOR PHONE', () => this.usePhone(), {
        color: tempoFlow.controllerMode === 'phone' ? P.green : P.blue, w: colW * .42, h: 44 * k, size: Math.round(13 * k),
      }))
    } else {
      add(new ComicButton(this, leftX + colW / 2, phoneBtnY, 'USE KEYBOARD ANYWAY', () => this.useKeyboard(), {
        color: tempoFlow.controllerMode === 'keyboard' ? P.green : P.paper, w: colW * .7, h: 44 * k, size: Math.round(14 * k),
      }))
    }

    // —— CAMERA ——
    add(comicPanel(this, rightX, cardY, colW, cardH, P.paper, -.4, 1))
    add(this.add.text(rightX + 22 * k, cardY + 18 * k, 'CAMERA SENSING', { fontFamily: DISPLAY, fontSize: `${Math.round(20 * k)}px`, color: HEX(P.blue) }))
    const snap = sensingSession.snapshot
    const previewX = rightX + 24 * k
    const previewY = cardY + 54 * k
    const previewW = colW - 48 * k
    const previewH = Math.min(220 * k, cardH * .42)
    const canvas = this.game.canvas
    const bounds = canvas.getBoundingClientRect()
    const sx = bounds.width / W, sy = bounds.height / H
    this.previewRect = new DOMRect(bounds.left + previewX * sx, bounds.top + previewY * sy, previewW * sx, previewH * sy)
    // Placeholder plate behind the DOM video
    add(this.add.rectangle(previewX, previewY, previewW, previewH, 0x1a1820).setOrigin(0).setDepth(11))
    add(this.add.rectangle(previewX, previewY, previewW, previewH).setOrigin(0).setDepth(11).setStrokeStyle(4 * k, P.ink))
    if (sensingSession.cameraReady) {
      sensingSession.setPreviewRect(this.previewRect)
      // Framing guide
      const gx = previewX + previewW * .2, gy = previewY + previewH * .12, gw = previewW * .6, gh = previewH * .76
      add(this.add.rectangle(gx, gy, gw, gh).setOrigin(0).setDepth(13).setStrokeStyle(2 * k, P.cyan, .85))
      add(this.add.text(previewX + previewW / 2, previewY + previewH - 14 * k, 'FACE + CHEST', {
        fontFamily: FONT, fontSize: `${Math.round(10 * k)}px`, color: HEX(P.cyan), fontStyle: '900',
      }).setOrigin(.5).setDepth(13))
    } else {
      add(this.add.text(previewX + previewW / 2, previewY + previewH / 2, tempoFlow.cameraMode === 'skipped' ? 'CAMERA SKIPPED' : 'LIVE PREVIEW', {
        fontFamily: DISPLAY, fontSize: `${Math.round(18 * k)}px`, color: HEX(0x8a7a68),
      }).setOrigin(.5).setDepth(12))
    }

    const statusY = previewY + previewH + 16 * k
    const rows: [string, string, number][] = [
      ['FACE', snap.facePresent || snap.validation === 'Ok' ? '✓' : snap.phase === 'off' || tempoFlow.cameraMode === 'skipped' ? '—' : '…', snap.facePresent || snap.validation === 'Ok' ? P.green : P.orange],
      ['SIGNAL', snap.phase === 'good' ? 'GOOD' : snap.phase === 'warming' || snap.phase === 'preview' ? 'WARMING' : snap.phase === 'error' || snap.phase === 'unavailable' ? 'UNAVAILABLE' : tempoFlow.cameraMode === 'skipped' ? 'SKIPPED' : 'OFF', snap.phase === 'good' ? P.green : P.orange],
      ['PULSE', snap.pulse ? `${Math.round(snap.pulse)}` : '—', P.blue],
    ]
    rows.forEach(([a, b, c], i) => {
      const y = statusY + i * 26 * k
      add(this.add.text(rightX + 24 * k, y, a, { fontFamily: DISPLAY, fontSize: `${Math.round(13 * k)}px`, color: HEX(P.ink) }))
      add(this.add.text(rightX + colW - 24 * k, y, b, { fontFamily: DISPLAY, fontSize: `${Math.round(13 * k)}px`, color: HEX(c) }).setOrigin(1, 0))
    })
    add(this.add.text(rightX + 24 * k, statusY + 90 * k, snap.guidance || sensingSession.consentCopy, {
      fontFamily: FONT, fontSize: `${Math.round(11 * k)}px`, color: HEX(0x5a4632), fontStyle: '900',
      wordWrap: { width: colW - 48 * k },
    }))
    if (snap.mock) {
      add(this.add.text(rightX + colW - 24 * k, cardY + 22 * k, 'MOCK SENSOR', {
        fontFamily: DISPLAY, fontSize: `${Math.round(12 * k)}px`, color: HEX(P.orange), backgroundColor: HEX(P.paper), padding: { x: 8, y: 3 },
      }).setOrigin(1, 0))
    }

    const camBtnY = cardY + cardH - 48 * k
    if (tempoFlow.cameraMode === 'skipped' || snap.phase === 'off') {
      add(new ComicButton(this, rightX + colW * .32, camBtnY, 'ENABLE CAMERA', () => void this.enableCamera(), {
        color: P.blue, w: colW * .42, h: 44 * k, size: Math.round(14 * k),
      }))
      add(new ComicButton(this, rightX + colW * .72, camBtnY, 'SKIP CAMERA', () => void this.skipCamera(), {
        color: P.paper, w: colW * .4, h: 44 * k, size: Math.round(14 * k),
      }))
    } else if (snap.phase === 'error' || snap.phase === 'unavailable') {
      add(new ComicButton(this, rightX + colW * .32, camBtnY, 'RETRY CAMERA', () => void this.retryCamera(), {
        color: P.orange, w: colW * .42, h: 44 * k, size: Math.round(14 * k),
      }))
      add(new ComicButton(this, rightX + colW * .72, camBtnY, 'PLAY WITHOUT', () => void this.skipCamera(), {
        color: P.green, w: colW * .4, h: 44 * k, size: Math.round(13 * k),
      }))
    } else {
      add(new ComicButton(this, rightX + colW / 2, camBtnY, 'SKIP CAMERA', () => void this.skipCamera(), {
        color: P.paper, w: colW * .55, h: 44 * k, size: Math.round(14 * k),
      }))
    }

    // —— START ——
    const canStart = tempoFlow.readyToStart
    add(comicPanel(this, W * .2, H - 96 * k, W * .6, 72 * k, canStart ? P.green : P.paper, 0, 1))
    add(this.add.text(W / 2, H - 82 * k, 'READY TO PLAY', { fontFamily: DISPLAY, fontSize: `${Math.round(14 * k)}px`, color: HEX(P.ink) }).setOrigin(.5, 0))
    add(new ComicButton(this, W / 2, H - 48 * k, 'START', () => this.startPlay(), {
      color: canStart ? P.gold : 0xcfc3a7, w: 220 * k, h: 40 * k, size: Math.round(20 * k),
    }))
  }

  update(_t: number, dt: number): void { this.city.update(dt) }
}

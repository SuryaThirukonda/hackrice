import Phaser from 'phaser'
import { controllerInput, type ControllerId } from '../input/controller'
import { controllerUrl, NO_LINK, resolveJoinLink, supportsMotion, type JoinLink } from '../input/joinLink'
import { ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'

/**
 * "Connect a phone": the in-app join screen. Launched over whatever is playing, which is paused
 * underneath so its own keyboard handlers stay quiet while this is up.
 *
 * It draws one QR per controller slot from the live tunnel address and keeps the claim state beside
 * each code, so a player can watch their own phone land in a slot. The address moves under it (a
 * quick tunnel is given a new hostname every restart), so it is re-read on a timer and the codes are
 * redrawn when it changes.
 */
interface Slot { id: ControllerId; player: 1 | 2; x: number; plate: Phaser.GameObjects.Rectangle; hint: Phaser.GameObjects.Text }

/** Design size of the panel. Everything is laid out at this size and scaled down to fit the window. */
const PANEL_W = 940, PANEL_H = 650, QR_PX = 200
const POLL_LINK_MS = 4000
const POLL_STATUS_MS = 300

export class ControllerScene extends Phaser.Scene {
  private from = 'menu'
  private link: JoinLink = NO_LINK
  /** Bumped on every create so a fetch or image decode left over from a restart cannot write to new objects. */
  private gen = 0
  private drawn = false
  private s = 1
  private slots: Slot[] = []
  private codes = new Map<ControllerId, Phaser.GameObjects.Image>()
  private chips = new Map<ControllerId, { box: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>()
  private address!: Phaser.GameObjects.Text
  private warn!: Phaser.GameObjects.Text
  private relay!: Phaser.GameObjects.Text
  constructor() { super('controller') }

  init(data: { from?: string }): void {
    this.from = data.from ?? 'menu'
    // A restart re-creates every game object, so nothing about the previous layout may survive: the
    // resolved link included, or the "unchanged address" check below would skip drawing entirely.
    this.gen++
    this.link = NO_LINK
    this.drawn = false
    this.slots = []
    this.codes.clear()
    this.chips.clear()
  }

  create(): void {
    ensureTextures(this)
    const W = this.scale.width, H = this.scale.height
    // One scale for the whole panel keeps the QR, the type and the gaps in proportion on any screen.
    const s = this.s = Math.max(0.45, Math.min(1, (W - 40) / PANEL_W, (H - 40) / PANEL_H))
    const pw = PANEL_W * s, ph = PANEL_H * s
    const px = W / 2 - pw / 2, py = H / 2 - ph / 2
    const font = (size: number): string => `${Math.round(size * s)}px`

    const backdrop = this.add.rectangle(0, 0, W, H, P.ink, 0.62).setOrigin(0).setDepth(200).setInteractive()
    backdrop.on('pointerdown', () => this.close())
    comicPanel(this, px, py, pw, ph, P.paper, 0.4).setDepth(201)
    new ComicButton(this, px + pw - 45 * s, py + 45 * s, '✕', () => this.close(), { color: P.red, w: 46 * s, h: 46 * s, size: 24 * s }).setDepth(205)
    this.fit(this.add.text(W / 2, py + 50 * s, 'CONNECT A PHONE', { fontFamily: DISPLAY, fontSize: font(44), color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 8 * s }).setOrigin(0.5).setDepth(202), pw - 120 * s)
    this.fit(this.add.text(W / 2, py + 86 * s, 'Scan with the phone camera, then tap Connect and Calibrate', { fontFamily: FONT, fontSize: font(15), color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(0.5).setDepth(202), pw - 60 * s)

    // The address is spelled out as well as encoded, for a phone that will not scan or has no camera.
    this.address = this.add.text(W / 2, py + 114 * s, 'looking for an address…', { fontFamily: FONT, fontSize: font(15), color: HEX(P.blue), fontStyle: '900' }).setOrigin(0.5).setDepth(202)

    for (const player of [1, 2] as const) this.slots.push(this.card(player, W / 2 + (player === 1 ? -160 : 160) * s, py + 140 * s))

    this.warn = this.add.text(W / 2, py + 448 * s, '', { fontFamily: FONT, fontSize: font(13), color: HEX(P.orange), fontStyle: '900', align: 'center' }).setOrigin(0.5).setDepth(202)
    this.fit(this.add.text(W / 2, py + 480 * s, 'The keyboard keeps working. A phone just adds motion.', { fontFamily: FONT, fontSize: font(13), color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(0.5).setDepth(202), pw - 60 * s)
    this.relay = this.add.text(W / 2, py + 512 * s, '', { fontFamily: FONT, fontSize: font(14), color: HEX(P.red), fontStyle: '900' }).setOrigin(0.5).setDepth(202)

    new ComicButton(this, W / 2, py + 566 * s, 'CLOSE', () => this.close(), { color: P.green, w: 240 * s, h: 50 * s, size: 22 * s }).setDepth(203)
    this.input.keyboard?.on('keydown-ESC', () => this.close())
    this.input.keyboard?.on('keydown-ENTER', () => this.close())

    void this.syncLink()
    this.time.addEvent({ delay: POLL_LINK_MS, loop: true, callback: () => void this.syncLink() })
    this.time.addEvent({ delay: POLL_STATUS_MS, loop: true, callback: () => this.syncStatus() })
    this.syncStatus()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose())
  }

  /** Shrink a line that would run past the panel edge, so nothing is clipped on a narrow window. */
  private fit(text: Phaser.GameObjects.Text, max: number): Phaser.GameObjects.Text {
    if (text.width > max) text.setScale(max / text.width)
    return text
  }

  /** One slot: a white plate for the code, the slot name, and a chip that follows the live claim state. */
  private card(player: 1 | 2, x: number, y: number): Slot {
    const s = this.s, side = (QR_PX + 18) * s
    const plate = this.add.rectangle(x, y + side / 2, side, side, 0xffffff).setDepth(202).setStrokeStyle(5 * s, P.ink)
    const hint = this.add.text(x, y + side / 2, '', { fontFamily: FONT, fontSize: `${Math.round(14 * s)}px`, color: HEX(0x5a4632), fontStyle: '900', align: 'center', wordWrap: { width: side - 30 * s }, lineSpacing: 4 * s }).setOrigin(0.5).setDepth(203)
    this.add.text(x, y + side + 20 * s, `CONTROLLER ${player}`, { fontFamily: DISPLAY, fontSize: `${Math.round(22 * s)}px`, color: HEX(P.ink) }).setOrigin(0.5).setDepth(202)
    const box = this.add.graphics().setDepth(202)
    const label = this.add.text(x, y + side + 48 * s, '', { fontFamily: DISPLAY, fontSize: `${Math.round(16 * s)}px`, color: HEX(P.paper) }).setOrigin(0.5).setDepth(203)
    const id: ControllerId = player === 1 ? 'controller_1' : 'controller_2'
    this.chips.set(id, { box, label })
    return { id, player, x, plate, hint }
  }

  private chip(id: ControllerId, text: string, color: number): void {
    const chip = this.chips.get(id)
    if (!chip || chip.label.text === text) return
    const s = this.s
    chip.label.setText(text)
    const w = Math.max(120 * s, chip.label.width + 28 * s), h = 30 * s
    const x = chip.label.x - w / 2, y = chip.label.y - h / 2
    chip.box.clear()
      .fillStyle(P.ink, 0.9).fillRoundedRect(x + 4 * s, y + 4 * s, w, h, 10 * s)
      .fillStyle(color).fillRoundedRect(x, y, w, h, 10 * s)
      .lineStyle(4 * s, P.ink).strokeRoundedRect(x, y, w, h, 10 * s)
  }

  /** Claim state and relay reachability, both read straight off the live client. */
  private syncStatus(): void {
    for (const slot of this.slots) {
      const on = controllerInput.connected(slot.id)
      this.chip(slot.id, on ? 'CONNECTED' : 'FREE', on ? P.green : P.blue)
    }
    this.relay.setText(controllerInput.linked() ? '' : 'Relay offline · start it with  npm run agent')
  }

  private async syncLink(): Promise<void> {
    const gen = this.gen
    const next = await resolveJoinLink()
    if (this.gen !== gen) return
    if (this.drawn && next.origin === this.link.origin) return
    this.link = next
    this.drawn = true
    this.address.setText(next.origin || 'no address yet')
    this.fit(this.address, (PANEL_W - 60) * this.s)
    // A LAN address still gets a phone onto the controller page; it just cannot read the sensors,
    // so it is offered with the limitation stated rather than withheld.
    this.warn.setText(next.origin && !supportsMotion(next)
      ? 'Same-WiFi address: D-pad and buttons only. Swings need the HTTPS tunnel.'
      : '')
    if (!next.origin) {
      for (const image of this.codes.values()) image.destroy()
      this.codes.clear()
      for (const slot of this.slots) slot.hint.setText('No address yet.\n\nStart the game with\nnpm run dev\n\nor run\nnpm run tunnel')
      return
    }
    for (const slot of this.slots) { slot.hint.setText(''); await this.code(slot, gen) }
  }

  /** Render one QR to a texture. Dynamically imported so the encoder never enters the game bundle. */
  private async code(slot: Slot, gen: number): Promise<void> {
    const value = controllerUrl(this.link, slot.player)
    if (!value) return
    let data = ''
    try {
      const QRCode = (await import('qrcode')).default
      data = await QRCode.toDataURL(value, { width: QR_PX * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141414', light: '#ffffff' } })
    } catch { return }
    if (this.gen !== gen) return
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => resolve(null)
      element.src = data
    })
    if (!image || this.gen !== gen) return
    // A reopened screen, or a tunnel that moved, replaces the texture rather than colliding with it.
    const key = `qr-${slot.id}`
    this.codes.get(slot.id)?.destroy()
    if (this.textures.exists(key)) this.textures.remove(key)
    this.textures.addImage(key, image)
    const side = QR_PX * this.s
    this.codes.set(slot.id, this.add.image(slot.x, slot.plate.y, key).setDisplaySize(side, side).setDepth(203))
  }

  private dispose(): void {
    this.gen++
    for (const id of ['controller_1', 'controller_2'] as const) {
      const key = `qr-${id}`
      if (this.textures.exists(key)) this.textures.remove(key)
    }
    this.codes.clear()
  }

  private close(): void {
    this.scene.stop()
    this.scene.resume(this.from)
  }
}

/** Open the connect screen over `scene`, pausing it so its own keys and sim stay put until this closes. */
export function openControllerConnect(scene: Phaser.Scene): void {
  const from = scene.scene.key
  scene.scene.pause(from)
  scene.scene.launch('controller', { from })
}

import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { bowlingParams, boxingParams, golfParams, loadSettings, PRESETS, randomSeed, saveSettings, SLIDER_KEYS, type Difficulty, type GameSettings, type Preset } from '../agent/sliders'
import { COURSES, courseById, type CourseId } from '../games/golf/sim/courses'
import { controllerInput } from '../input/controller'
import { openControllerConnect } from './ControllerScene'

export interface PreFightData { game: 'boxing' | 'bowling' | 'golf'; mode?: '1p' | 'card' }
/** Settings plus the golf course pick; it rides along in the same saved blob (loadSettings spreads unknown keys through). */
type PreSettings = GameSettings & { course?: CourseId }

/** Difficulty presets, sliders, seed. Deterministic: the same seed and inputs replay the same match. */
export class PreFightScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private d!: PreFightData
  private s!: PreSettings
  private row = 0 // 0 presets, 1..5 sliders, [6 course: golf only], then seed, then start
  private content: Phaser.GameObjects.GameObject[] = []
  private promptObjects: Phaser.GameObjects.GameObject[] = []
  private phonePromptOpen = false
  private seed = 0
  constructor() { super('prefight') }
  init(d: PreFightData): void { this.d = d; this.s = loadSettings(); this.seed = this.s.seed ?? randomSeed(); this.row = this.startRow }

  private get golf(): boolean { return this.d.game === 'golf' }
  private get courseRow(): number { return this.golf ? 6 : -1 }
  private get seedRow(): number { return this.golf ? 7 : 6 }
  private get startRow(): number { return this.seedRow + 1 }
  private get nRows(): number { return this.startRow + 1 }
  private get course() { return courseById(this.s.course) }
  private cycleCourse(d: number): void {
    const i = COURSES.findIndex((c) => c.id === this.course.id)
    this.s.course = COURSES[(i + d + COURSES.length) % COURSES.length].id; this.save()
  }

  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 33)
    const kb = this.input.keyboard!
    kb.on('keydown-DOWN', () => { if (!this.phonePromptOpen) this.move(1) })
    kb.on('keydown-UP', () => { if (!this.phonePromptOpen) this.move(-1) })
    kb.on('keydown-LEFT', () => { if (!this.phonePromptOpen) this.adjust(-1) })
    kb.on('keydown-RIGHT', () => { if (!this.phonePromptOpen) this.adjust(1) })
    kb.on('keydown-ENTER', () => {
      if (this.phonePromptOpen) {
        this.closePhonePrompt()
        openControllerConnect(this)
        return
      }
      this.activate()
    })
    kb.on('keydown-SPACE', () => {
      if (this.phonePromptOpen) {
        this.closePhonePrompt()
        openControllerConnect(this)
        return
      }
      this.activate()
    })
    kb.on('keydown-X', () => {
      if (this.phonePromptOpen) this.closePhonePrompt()
      this.launchGame()
    })
    kb.on('keydown-ESC', () => {
      if (this.phonePromptOpen) {
        this.closePhonePrompt()
        return
      }
      wipeTo(this, 'games', { mode: this.d.mode ?? '1p' })
    })
    kb.on('keydown-H', () => {
      if (!this.phonePromptOpen) wipeTo(this, 'tutorial', { game: this.d.game, from: 'prefight' })
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closePhonePrompt())
    this.draw()
  }
  private move(d: number): void { const n = this.nRows; this.row = (this.row + d + n) % n; sfx.hover(); this.draw() }
  private setPreset(p: Preset): void { this.s.preset = p; if (p !== 'custom') this.s.difficulty = { ...PRESETS[p] }; this.save() }
  private adjust(d: number): void {
    if (this.row === 0) { const ps: Preset[] = ['rookie', 'pro', 'champ', 'custom']; this.setPreset(ps[(ps.indexOf(this.s.preset) + d + 4) % 4]) }
    else if (this.row <= 5) { const k = SLIDER_KEYS[this.row - 1]; this.s.difficulty[k] = Math.round(Math.min(1, Math.max(0, this.s.difficulty[k] + d * 0.1)) * 10) / 10; this.s.preset = 'custom'; this.save() }
    else if (this.row === this.courseRow) this.cycleCourse(d)
    else if (this.row === this.seedRow) { this.seed = randomSeed() }
    sfx.hover(); this.draw()
  }
  private activate(): void {
    if (this.row === this.seedRow) { this.seed = randomSeed(); this.draw(); return }
    if (this.row === this.courseRow) { this.cycleCourse(1); sfx.hover(); this.draw(); return }
    if (this.row === this.startRow || this.row === 0) this.start()
  }
  private save(): void { saveSettings(this.s) }
  private start(): void {
    if (controllerInput.connected('controller_1')) {
      this.launchGame()
      return
    }
    this.showPhonePrompt()
  }

  private launchGame(): void {
    sfx.select()
    const diff: Difficulty = this.s.difficulty
    if (this.d.game === 'boxing') wipeTo(this, 'boxing', { mode: this.d.mode ?? '1p', tier: this.s.preset === 'custom' ? 'pro' : this.s.preset, bot: boxingParams(diff), seed: this.seed })
    else if (this.d.game === 'bowling') wipeTo(this, 'bowling', { mode: '1p', tier: this.s.preset === 'custom' ? 'pro' : this.s.preset, bot: bowlingParams(diff), seed: this.seed })
    else wipeTo(this, 'golf', { mode: '1p', tier: this.s.preset === 'custom' ? 'pro' : this.s.preset, bot: golfParams(diff), seed: this.seed, course: this.course.id })
  }

  private showPhonePrompt(): void {
    if (this.phonePromptOpen) return
    this.phonePromptOpen = true
    const { width: W, height: H } = this.scale
    const addPrompt = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.promptObjects.push(o); return o }

    const backdrop = addPrompt(this.add.rectangle(0, 0, W, H, P.ink, 0.65).setOrigin(0).setDepth(300).setInteractive())
    backdrop.on('pointerdown', () => this.closePhonePrompt())

    addPrompt(comicPanel(this, W / 2 - 270, H / 2 - 165, 540, 330, P.paper, 0.5).setDepth(301))
    addPrompt(this.add.text(W / 2, H / 2 - 105, 'JOIN WITH PHONE?', { fontFamily: DISPLAY, fontSize: '32px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 6 }).setOrigin(0.5).setDepth(302))
    addPrompt(this.add.text(W / 2, H / 2 - 50, 'Scan a QR code to use motion controls with your phone,\nor press X to play with keyboard!', { fontFamily: FONT, fontSize: '15px', color: HEX(P.ink), fontStyle: '900', align: 'center', lineSpacing: 4 }).setOrigin(0.5).setDepth(302))

    addPrompt(new ComicButton(this, W / 2, H / 2 + 18, '📱 CONNECT PHONE [ENTER]', () => {
      this.closePhonePrompt()
      openControllerConnect(this)
    }, { color: P.blue, w: 340, h: 48, size: 18 }).setDepth(302))

    addPrompt(new ComicButton(this, W / 2, H / 2 + 76, '⌨ USE KEYBOARD [X]', () => {
      this.closePhonePrompt()
      this.launchGame()
    }, { color: P.green, w: 340, h: 48, size: 18 }).setDepth(302))

    addPrompt(new ComicButton(this, W / 2 + 235, H / 2 - 135, '✕', () => this.closePhonePrompt(), { color: P.paper, w: 34, h: 34, size: 18 }).setDepth(302))
  }

  private closePhonePrompt(): void {
    this.phonePromptOpen = false
    for (const o of this.promptObjects) o.destroy()
    this.promptObjects = []
  }

  private fit(text: Phaser.GameObjects.Text, max: number): Phaser.GameObjects.Text {
    if (text.width > max) text.setScale(max / text.width)
    return text
  }

  private draw(): void {
    for (const o of this.content) o.destroy()
    this.content = []
    const { width: W, height: H } = this.scale
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    add(comicPanel(this, W / 2 - 400, 40, 800, H - 80, P.paper, 1))
    add(new ComicButton(this, W / 2 - 335, 78, '◀ BACK', () => wipeTo(this, 'games', { mode: this.d.mode ?? '1p' }), { color: P.blue, w: 100, h: 38, size: 16 }))
    const title = add(this.add.text(W / 2, 78, `${this.d.game.toUpperCase()} · CHOOSE YOUR OPPONENT`, { fontFamily: DISPLAY, fontSize: '26px', color: HEX(P.ink) }).setOrigin(0.5))
    this.fit(title, 450)
    add(new ComicButton(this, W / 2 + 335, 78, 'HELP', () => wipeTo(this, 'tutorial', { game: this.d.game, from: 'prefight' }), { color: P.gold, w: 86, h: 38, size: 16 }))
    const rowY = (i: number) => 150 + i * (this.golf ? 55 : 62) // golf fits one more row (the course) in the same panel
    const focus = (i: number) => (this.row === i ? P.gold : P.paper)
    const seedRow = this.seedRow, startRow = this.startRow
    // presets row
    add(this.add.text(W / 2 - 340, rowY(0), 'PRESET', { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.ink) }).setOrigin(0, 0.5))
    ;(['rookie', 'pro', 'champ', 'custom'] as Preset[]).forEach((p, i) => {
      const b = add(new ComicButton(this, W / 2 - 110 + i * 130, rowY(0), p.toUpperCase(), () => { this.row = 0; this.setPreset(p); this.draw() }, { color: this.s.preset === p ? P.red : focus(0), w: 120, h: 44, size: 18 }))
      if (this.s.preset === p) b.setScale(1.05)
    })
    SLIDER_KEYS.forEach((k, i) => {
      const y = rowY(i + 1), v = this.s.difficulty[k]
      add(this.add.text(W / 2 - 340, y, k.toUpperCase(), { fontFamily: DISPLAY, fontSize: '22px', color: HEX(this.row === i + 1 ? P.red : P.ink) }).setOrigin(0, 0.5))
      const g = add(this.add.graphics())
      g.fillStyle(P.ink).fillRoundedRect(W / 2 - 150, y - 8, 460, 16, 8)
      g.fillStyle(this.row === i + 1 ? P.red : P.blue).fillRoundedRect(W / 2 - 147, y - 5, 454 * v, 10, 5)
      g.fillStyle(P.gold).fillCircle(W / 2 - 147 + 454 * v, y, 13); g.lineStyle(3, P.ink).strokeCircle(W / 2 - 147 + 454 * v, y, 13)
      add(this.add.text(W / 2 + 330, y, `${Math.round(v * 100)}`, { fontFamily: FONT, fontSize: '18px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
      const hit = add(this.add.zone(W / 2 + 80, y, 480, 32).setInteractive({ cursor: 'pointer' }))
      const setVal = (px: number) => {
        const frac = Math.max(0, Math.min(1, (px - (W / 2 - 147)) / 454))
        this.s.difficulty[k] = Math.round(frac * 10) / 10
        this.s.preset = 'custom'
        this.row = i + 1
        this.save()
        sfx.hover()
        this.draw()
      }
      hit.on('pointerdown', (p: Phaser.Input.Pointer) => setVal(p.x))
      hit.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) setVal(p.x) })
    })
    if (this.golf) {
      const cr = this.courseRow, c = this.course
      add(this.add.text(W / 2 - 340, rowY(cr), 'COURSE', { fontFamily: DISPLAY, fontSize: '22px', color: HEX(this.row === cr ? P.red : P.ink) }).setOrigin(0, 0.5))
      add(new ComicButton(this, W / 2 + 80, rowY(cr), `◀  ${c.name.toUpperCase()}  ▶`, () => { this.row = cr; this.cycleCourse(1); this.draw() }, { color: focus(cr), w: 420, h: 44, size: 18 }))
    }
    add(this.add.text(W / 2 - 340, rowY(seedRow), 'SEED', { fontFamily: DISPLAY, fontSize: '22px', color: HEX(this.row === seedRow ? P.red : P.ink) }).setOrigin(0, 0.5))
    add(new ComicButton(this, W / 2 + 80, rowY(seedRow), `${this.seed}  ·  reroll`, () => { this.seed = randomSeed(); this.draw() }, { color: focus(seedRow), w: 420, h: 44, size: 18 }))
    add(this.add.text(W / 2, rowY(seedRow) + 38, 'same seed + same inputs = the same fight, every time', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    const start = add(new ComicButton(this, W / 2, H - 92, 'FIGHT!', () => this.start(), { color: this.row === startRow ? P.red : P.green, w: 360, h: 66, size: 32 }))
    if (this.row === startRow) start.setScale(1.06)
    add(this.add.text(W / 2, H - 42, '↑↓ rows · ←→ adjust · Enter start · X keyboard fight · Esc back · click any item', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 10, y: 4 } }).setOrigin(0.5))
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}

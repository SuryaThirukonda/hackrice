import Phaser from 'phaser'
import { HealthTracker, summaryLine } from '../../health/tracker'
import { healthBadge } from '../../health/liveBadge'
import { Engine3D } from '../../engine3d/Engine3D'
import { sfx } from '../../fx/sfx'
import { wipeTo } from '../../fx/transitions'
import { KeyState } from '../../input/keys'
import { loadSettings } from '../../agent/sliders'
import { comicPanel } from '../../ui/widgets'
import { DISPLAY, HEX, P } from '../../theme'
import { previewPath } from './sim/preview'
import { applyAim, BOWLING_HELP, BOWLING_KEYS, bowlingInput, bowlingControllerState, controllerBowlingCommand, defaultAim, keyLabel, MeterTracker, meterValue, type AimState, type BowlingBindings } from './keymap'
import { controllerInput } from '../../input/controller'
import { bowlingPractice, type PracticeStep, type PracticeView } from './tutorial'
import { BowlingHud } from './hud/BowlingHud'
import { BowlingWorld } from './render/BowlingWorld'
import { playVictoryAnimation } from '../../fx/victoryAnimation'
import { Announcer } from '../../announcer'
import { BowlingGame } from './sim/game'
import { TIERS } from './sim/bot'
import { HZ } from './sim/constants'
import type { BotParams, BowlingEvent, Snapshot } from './sim/types'

export interface BowlingSceneData { mode?: '1p' | '2p'; bot?: BotParams; tier?: keyof typeof TIERS; seed?: number; practice?: boolean }

const STEP_MS = 1000 / HZ

/** First-person 3D bowling: Phaser owns input and simulation; PlayCanvas renders behind it. */
export class BowlingScene extends Phaser.Scene {
  private data3!: BowlingSceneData
  private sim!: BowlingGame
  private hud!: BowlingHud
  private world: BowlingWorld | null = null
  private keys = new KeyState()
  private meter = new MeterTracker()
  private detach: (() => void) | null = null
  private acc = 0
  private curr!: Snapshot
  private aim: AimState = defaultAim()
  private charging = false
  private pad = bowlingControllerState()
  private chargeStart = 0
  private power: number | null = null
  private paused = false
  private ended = false
  private health!: HealthTracker
  private badge: { update: () => void; destroy: () => void } | null = null
  private ready = false
  private startedAt = 0
  private lastPinSfx = 0
  private seed = 0
  private eventLog: string[] = []
  private bindings: BowlingBindings = BOWLING_KEYS
  private steps: PracticeStep[] = []
  private stepIx = 0
  private guide: Phaser.GameObjects.GameObject[] = []
  /** The spoken announcer for this game; silent in practice. */
  private announcer: Announcer<'bowling'> | null = null

  constructor() { super('bowling') }

  init(d: BowlingSceneData): void { this.data3 = d ?? {} }

  private get is2p(): boolean { return this.data3.mode === '2p' }
  private get houseName(): string { return this.data3.practice ? 'PRACTICE' : `THE HOUSE (${(this.data3.tier ?? 'rookie').toUpperCase()})` }

  create(): void {
    const d = this.data3
    const is2p = this.is2p
    const seed = d.seed ?? Math.floor(Math.random() * 1e9)
    this.seed = seed
    const bot = (d.practice || is2p) ? null : (d.bot ?? TIERS[d.tier ?? 'rookie'])
    this.sim = new BowlingGame({ seed, botB: bot })
    this.curr = this.sim.snapshot()
    const settings = loadSettings()
    sfx.enabled = settings.sound
    this.bindings = { ...BOWLING_KEYS, ...(settings.bindings.bowling as Partial<BowlingBindings> | undefined) }
    this.steps = d.practice ? bowlingPractice(this.bindings) : []
    this.stepIx = 0
    this.aim = defaultAim(); this.charging = false; this.power = null; this.meter.reset()
    controllerInput.setSport('bowling'); controllerInput.clear('controller_1'); this.pad = bowlingControllerState()
    // The match's movement record. Ends with the match, or when the scene is left any other way.
    this.health = new HealthTracker('bowling')
    this.badge?.destroy(); this.badge = healthBadge(this, this.health, 30, 96)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { void this.health.end(); this.badge?.destroy(); this.badge = null })
    this.hud = new BowlingHud(this)
    this.hud.names = is2p ? ['PLAYER 1', 'PLAYER 2'] : ['YOU', this.houseName]
    this.hud.layout(this.scale.width, this.scale.height)
    this.hud.showCard('LOADING LANE', P.gold, `seed ${seed}`, 0)
    this.announcer = new Announcer(this, { sport: 'bowling', practice: !!d.practice, perspective: is2p ? { mode: '2p' } : { mode: '1p' } })
    this.acc = 0; this.paused = false; this.ended = false; this.ready = false; this.eventLog = []; this.lastPinSfx = 0
    this.detach = this.keys.attach(window)
    this.input.keyboard!.on('keydown-ESC', () => this.togglePause())
    this.input.keyboard!.on('keydown-H', () => { if (!this.ended) this.togglePause() })
    this.input.keyboard!.on('keydown-Q', () => { if (this.paused) this.quit() })
    this.input.once('pointerdown', () => sfx.unlock())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown())
    const w = (window as unknown as { __bowling?: BowlingScene }); w.__bowling = this
    void Engine3D.get().then((engine) => {
      if (!this.scene.isActive()) return
      engine.setQuality(loadSettings().quality)
      this.world = new BowlingWorld(engine)
      this.world.show(this.scale.width, this.scale.height)
      this.hud.clearCard()
      this.ready = true
      this.startedAt = this.time.now
      this.world.apply(this.curr, this.aim, 0)
      this.updateTurn()
      this.announcer?.start()
    })
  }

  onResize(): void {
    this.hud.layout(this.scale.width, this.scale.height)
    this.world?.resize(this.scale.width, this.scale.height)
    this.announcer?.layout(this.scale.width, this.scale.height)
  }

  private togglePause(): void {
    if (this.ended) return
    this.paused = !this.paused
    this.announcer?.pause(this.paused)
    if (this.paused) {
      sfx.back()
      this.hud.pauseOverlay(BOWLING_HELP.map((h) => ({ keys: this.bindings[h.action].map(keyLabel).join(' / '), label: h.label, hint: h.hint })), [
        { label: 'RESUME', color: P.green, cb: () => this.togglePause() },
        { label: 'HOW TO PLAY', color: P.gold, cb: () => wipeTo(this, 'tutorial', { game: 'bowling', from: 'menu' }) },
        { label: 'QUIT', color: P.red, cb: () => this.quit() },
      ])
    } else { sfx.select(); this.hud.clearOverlay() }
  }

  private quit(): void { wipeTo(this, 'menu') }

  /** True while the human is expected to release a ball. */
  private get humanTurn(): boolean { return this.sim.phase === 'aim' && !this.sim.bot() }

  private updateTurn(): void {
    const g = this.sim
    if (g.phase === 'game_end') { this.hud.setTurn(''); return }
    const ball = g.frame === 10 ? `BALL ${g.ball}` : g.ball === 1 ? 'FIRST BALL' : 'SECOND BALL'
    if (this.is2p) {
      const pName = g.current === 'a' ? 'PLAYER 1' : 'PLAYER 2'
      const col = g.current === 'a' ? P.gold : P.blue
      this.hud.setTurn(`${pName}'S ROLL · FRAME ${g.frame} · ${ball}`, col)
    } else if (g.bot()) {
      this.hud.setTurn(`THE HOUSE ROLLS · FRAME ${g.frame}`, P.red)
    } else {
      this.hud.setTurn(`YOUR ROLL · FRAME ${g.frame} · ${ball}`, P.gold)
    }
  }

  private release(power: number): void {
    if (!this.humanTurn) return
    this.charging = false; this.power = null; this.hud.meter(null); this.pad = bowlingControllerState()
    if (this.sim.startRoll({ lanePos: this.aim.lanePos, angleDeg: this.aim.angleDeg, power, hook: this.aim.hook })) sfx.whoosh(power > 0.7)
  }

  private onEvent(e: BowlingEvent, batch: BowlingEvent[]): void {
    this.eventLog.push(JSON.stringify(e))
    this.announcer?.event(e, () => ({ batch, standing: this.sim.standingPins().map((p) => p.index), player: this.sim.current, frame: this.sim.frame }))
    const w = this.world
    switch (e.kind) {
      case 'roll_start': sfx.whoosh(e.shot.power > 0.7); this.hud.aimReadout(null); this.updateTurn(); break
      case 'gutter': sfx.thud(0.4); this.hud.burst('GUTTER', P.purple, 52); break
      case 'pin_hit': {
        const now = this.time.now
        if (now - this.lastPinSfx > 50) { this.lastPinSfx = now; if (e.pin === 0) sfx.thud(0.9); else sfx.block() }
        w?.shake(e.pin === 0 ? 0.5 : 0.15)
        { const pin = this.curr.pins.find((p) => p.index === e.pin); if (pin) w?.pinHitFx(pin.x, pin.z) }
        break
      }
      case 'pins_down':
        if (!batch.some((x) => x.kind === 'strike' || x.kind === 'spare')) { if (e.count > 0) this.hud.burst(`${e.count} DOWN`, e.count >= 7 ? P.orange : P.cyan, 56); sfx.stamp() }
        break
      case 'strike': {
        sfx.win(); sfx.crowd(0.4, 1.2); w?.strikeFx(); w?.shake(0.8)
        const col = this.is2p ? (e.player === 'a' ? P.gold : P.blue) : (e.player === 'a' ? P.gold : P.red)
        const prefix = this.is2p ? (e.player === 'a' ? 'P1 ' : 'P2 ') : ''
        this.hud.burst(`${prefix}STRIKE!`, col, 92)
        break
      }
      case 'spare': {
        sfx.sparkle(); sfx.crowd(0.25, 0.8); w?.cheer(); w?.sweepDust()
        const col = this.is2p ? (e.player === 'a' ? P.green : P.blue) : (e.player === 'a' ? P.green : P.red)
        const prefix = this.is2p ? (e.player === 'a' ? 'P1 ' : 'P2 ') : ''
        this.hud.burst(`${prefix}SPARE!`, col, 76)
        break
      }
      case 'frame_end': sfx.stamp(); break
      case 'game_end': sfx.bell(2); this.time.delayedCall(900, () => this.finish()); break
      default: break
    }
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    void this.health.end().then((line) => { if (line && this.scene.isActive()) this.hud.setHint(summaryLine(line)) })
    this.hud.clearCard(); this.hud.meter(null); this.hud.aimReadout(null); this.hud.setTurn('')
    const r = this.sim.winner(), sb = this.sim.scoreboard()
    const youWin = r === 'a'
    const draw = r === 'draw'
    if (youWin || (this.is2p && r === 'b')) sfx.win()
    const strikes = (rolls: number[][]) => rolls.filter((f) => f[0] === 10).length
    const n1 = this.hud.names[0].toLowerCase(), n2 = this.hud.names[1].toLowerCase()
    const lines = [
      `${n1} ${sb.a.total} · ${n2} ${sb.b.total}`,
      `${n1}: ${strikes(this.sim.rolls.a)} strikes`,
      `${n2}: ${strikes(this.sim.rolls.b)} strikes`,
      `seed ${this.seed}`,
    ]
    let title = youWin ? 'YOU WIN!' : draw ? 'DRAW' : 'THE HOUSE WINS'
    let titleColor = youWin ? P.green : draw ? P.blue : P.red
    if (this.is2p) {
      if (youWin) { title = 'PLAYER 1 WINS!'; titleColor = P.green }
      else if (r === 'b') { title = 'PLAYER 2 WINS!'; titleColor = P.blue }
      else { title = 'DRAW'; titleColor = P.gold }
    }
    playVictoryAnimation({
      scene: this,
      winner: r ?? (youWin ? 'a' : 'b'),
      is2p: this.is2p,
      p1Name: this.hud.names[0],
      p2Name: this.hud.names[1],
      sport: 'bowling',
      onComplete: () => {
        if (!this.scene.isActive()) return
        this.hud.result(title, lines, titleColor, () => this.scene.restart(this.data3), () => this.quit())
      },
    })
  }

  update(_t: number, deltaMs: number): void {
    this.health.pump(); this.badge?.update()
    if (!this.ready || !this.world) return
    const inp = bowlingInput(this.keys, this.bindings, this.meter)
    if (inp.sheet) { sfx.hover(); this.hud.toggleSheet() }
    this.keys.endFrame()
    const dtS = Math.min(deltaMs, 100) / 1000
    const currentController = (this.is2p && this.sim.current === 'b' && controllerInput.connected('controller_2'))
      ? 'controller_2'
      : 'controller_1'
    const remote = controllerBowlingCommand(
      controllerInput.stick(currentController),
      controllerInput.drain(currentController, 'bowling'),
      this.pad,
      controllerInput.connected(currentController)
    )
    this.pad = { hookArmed: remote.hookArmed, armed: remote.armed }
    if (this.paused || this.ended) { this.world.apply(this.curr, this.humanTurn ? this.swayed() : null, dtS, this.path()); this.hud.update(this.curr, dtS); return }
    // aim phase: adjust the shot, charge and release
    if (this.humanTurn) {
      // the phone's D-pad adds hook one step per flick; the keyboard wins the frame when both are used
      this.aim = applyAim(this.aim, inp.hook !== 0 ? inp : { ...inp, hook: remote.command.hook }, dtS)
      this.hud.aimReadout(this.aim, this.curr.sway, this.curr.swayLocked)
      if (!this.sim.locked) {
        // stage 1: the line sweeps; the first tap (or Enter, or A on the phone) locks it
        if (inp.meterPress || inp.confirm || remote.command.lock) { if (this.sim.lockSway()) { sfx.stamp(); this.hud.burst('LOCKED', P.green, 44) } }
        if (remote.command.arm) this.hud.burst('LOCK THE LINE FIRST · A', P.orange, 36)
      } else if (remote.command.swingPower !== null && !this.charging) {
        // phone: B armed the throw, and this swing is the release; power comes from the swing speed
        this.release(remote.command.swingPower)
      } else if (remote.command.arm && !this.charging) { sfx.select(); this.hud.burst('ARMED · SWING', P.blue, 44) }
      else if (remote.command.lock && this.pad.armed && !this.charging) {
        // blue button press while armed also releases
        this.release(0.8)
      }
      else if (inp.meterPress && !this.charging) {
        // stage 2: a fresh press starts the charge
        this.charging = true; this.chargeStart = this.time.now
      }
      if (this.charging) {
        if (inp.meterDown) { this.power = meterValue(this.time.now - this.chargeStart); this.hud.meter(this.power) }
        else if (inp.meterRelease && this.power !== null) this.release(this.power) // stage 3: release rolls
      }
    } else if (this.charging) { this.charging = false; this.power = null; this.hud.meter(null) }
    // fixed-step sim
    this.acc += Math.min(deltaMs, 100)
    const wasPhase = this.sim.phase, wasCurrent = this.sim.current, wasBall = this.sim.ball
    while (this.acc >= STEP_MS) {
      this.sim.step()
      if (this.sim.events.length) {
        const batch = this.sim.events
        for (const e of batch) this.onEvent(e, batch)
        if (this.steps.length) { this.curr = this.sim.snapshot(); this.practice(batch) }
      }
      this.acc -= STEP_MS
    }
    this.curr = this.sim.snapshot()
    if (this.sim.phase !== wasPhase || this.sim.current !== wasCurrent || this.sim.ball !== wasBall) this.updateTurn()
    this.announcer?.frame(this.curr)
    if (this.steps.length && !this.sim.events.length) this.practice([])
    this.world.apply(this.curr, this.humanTurn ? this.swayed() : null, dtS, this.path())
    this.hud.update(this.curr, dtS)
  }

  /** Predicted path for the current aim, sway and (while charging) live power. */
  private path() { return this.humanTurn ? previewPath({ lanePos: this.aim.lanePos, angleDeg: this.aim.angleDeg, power: this.charging && this.power !== null ? this.power : 0.75, hook: this.aim.hook }, this.curr.sway) : null }

  /** The aim the guide shows: the player's angle plus the lane's sway at this instant. */
  private swayed(): AimState { return { ...this.aim, angleDeg: this.aim.angleDeg + this.curr.sway } }

  private view(): PracticeView { return { ...this.curr, aim: this.aim, charging: this.charging } }

  /** Guided practice: advance the prompt when the current step's condition is met. */
  private practice(events: BowlingEvent[]): void {
    if (this.stepIx >= this.steps.length) return
    const step = this.steps[this.stepIx]
    const v = this.view()
    const hit = events.length ? events.some((e) => step.done(e, v)) : step.done(null, v)
    if (this.guide.length === 0) this.drawGuide()
    if (!hit) return
    this.stepIx++
    sfx.sparkle(); this.hud.burst('NICE!', P.green, 50)
    this.drawGuide()
    if (this.stepIx >= this.steps.length) {
      this.time.delayedCall(800, () => {
        if (this.ended) return
        this.ended = true
        this.hud.meter(null)
        this.hud.result('READY TO BOWL', ['you know the approach', 'pick an opponent and go'], P.green, () => wipeTo(this, 'prefight', { game: 'bowling', mode: '1p' }), () => this.quit(), ['PICK AN OPPONENT', 'BACK TO MENU'])
      })
    }
  }
  private drawGuide(): void {
    for (const o of this.guide) o.destroy()
    this.guide = []
    if (this.stepIx >= this.steps.length) return
    const W = this.scale.width
    this.guide.push(comicPanel(this, W / 2 - 300, 176, 600, 64, P.gold, 1).setDepth(105))
    this.guide.push(this.add.text(W / 2, 208, `${this.stepIx + 1}/${this.steps.length}  ${this.steps[this.stepIx].text}`, { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(106).setAngle(1))
  }

  /** Dev/test hook: the event log so replays can be compared. */
  getEventLog(): string[] { return this.eventLog }

  private shutdown(): void {
    this.detach?.(); this.detach = null
    this.input.keyboard?.removeAllListeners()
    this.world?.hide()
    this.hud.destroy()
    for (const o of this.guide) o.destroy()
    this.guide = []
    this.world = null
    void this.startedAt
  }
}

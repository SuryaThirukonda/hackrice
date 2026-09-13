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
import { GOLF_HELP, GOLF_KEYS, SwingMeter, golfInput, keyLabel, type GolfBindings, controllerGolfCommand, golfControllerState } from './keymap'
import { controllerInput } from '../../input/controller'
import { golfPractice, type GolfPracticeStep, type GolfPracticeUi } from './tutorial'
import { GolfHud, CLUB_NAMES, toParText } from './hud/GolfHud'
import { GolfWorld, type AimState } from './render/GolfWorld'
import { CLUBS, CLUB_LIST, FULL_CLUBS, GolfRound, HZ, LIE_MUL, Rng, TIERS, courseById, simulateShot, surfaceAt, type CourseId } from './sim'
import type { BotParams, Club, GolfEvent, GolfSnapshot, Player, Surface } from './sim/types'
import { tempoFlow } from '../../wellness/tempoFlow'

export interface GolfSceneData { mode?: '1p'; bot?: BotParams; tier?: keyof typeof TIERS; seed?: number; practice?: boolean; holes?: number[]; course?: CourseId; tempo?: boolean }

const STEP_MS = 1000 / HZ
const AIM_RATE = 32       // deg/s while a key is held
const PUTT_AIM_RATE = 12
const PREVIEW_MS = 100    // preview recompute throttle (10 Hz)
const PREVIEW_POWER = 0.6
const RAD = 180 / Math.PI

/** Clubs allowed from a lie: putter only on the green, no putter from sand, anything elsewhere. */
export function allowedClubs(surface: Surface): readonly Club[] {
  if (surface === 'green') return ['putter']
  if (surface === 'bunker') return FULL_CLUBS
  return CLUB_LIST
}
/** Shortest club that reaches the cup from this lie (driver if nothing does; putter on the green). */
export function suggestClub(surface: Surface, dist: number): Club {
  if (surface === 'green') return 'putter'
  const mul = LIE_MUL[surface]
  for (const c of [...FULL_CLUBS].reverse()) if (CLUBS[c].carry * mul >= dist) return c
  return 'driver'
}

/** First-person 3D golf: Phaser owns input and simulation; PlayCanvas renders behind it. */
export class GolfScene extends Phaser.Scene {
  private data3!: GolfSceneData
  private round!: GolfRound
  private hud!: GolfHud
  private world: GolfWorld | null = null
  private keys = new KeyState()
  private detach: (() => void) | null = null
  private acc = 0
  private prev!: GolfSnapshot
  private curr!: GolfSnapshot
  private paused = false
  private ended = false
  private health!: HealthTracker
  private badge: { update: () => void; destroy: () => void } | null = null
  private ready = false
  private eventLog: string[] = []
  private bindings: GolfBindings = GOLF_KEYS
  private meter = new SwingMeter()
  private club: Club = 'driver'
  private pad = golfControllerState()
  private heading = 0
  private topView = false
  private aiming = false          // true while the player is in control of an aim phase
  private previewAt = -1e9
  private previewDirty = true
  private previewShown = false
  private steps: GolfPracticeStep[] = []
  private stepIx = 0
  private practiceUi: GolfPracticeUi = { clubChanges: 0, aimTurnedDeg: 0, swings: 0 }
  private guide: Phaser.GameObjects.GameObject[] = []
  private nHoles = 3

  constructor() { super('golf') }

  private get practice(): boolean { return !!this.data3.practice }

  init(d: GolfSceneData): void { this.data3 = d ?? {} }

  create(): void {
    const d = this.data3
    const seed = d.seed ?? Math.floor(Math.random() * 1e9)
    const bot = d.practice ? null : (d.bot ?? TIERS[d.tier ?? 'rookie'])
    const course = courseById(d.course)
    this.round = new GolfRound({ seed, holes: d.holes ?? course.holes, windRange: course.wind, botA: null, botB: bot })
    this.nHoles = this.round.holeList.length
    this.prev = this.curr = this.round.snapshot()
    const settings = loadSettings()
    sfx.enabled = settings.sound
    this.bindings = { ...GOLF_KEYS, ...(settings.bindings.golf as Partial<GolfBindings> | undefined) }
    this.steps = d.practice ? golfPractice(this.bindings) : []
    this.stepIx = 0; this.practiceUi = { clubChanges: 0, aimTurnedDeg: 0, swings: 0 }
    this.hud = new GolfHud(this)
    this.hud.setCourseName(course.name)
    this.hud.setNames('YOU', d.practice ? 'YOU (BALL B)' : `THE HOUSE (${(d.tier ?? 'rookie').toUpperCase()})`)
    this.hud.layout(this.scale.width, this.scale.height)
    const k = (a: keyof GolfBindings) => this.bindings[a].map(keyLabel).join('/')
    this.hud.setHint(`${k('clubUp')}/${k('clubDown')} club · ${k('aimLeft')}/${k('aimRight')} aim · ${k('swing')} swing ×3 · ${k('view')} map · Esc pause · H help`)
    this.hud.showCard('LOADING COURSE', P.gold, `${course.name.toLowerCase()} · seed ${seed}`, 0)
    this.acc = 0; this.paused = false; this.ended = false; this.ready = false; this.eventLog = []
    this.meter.reset(); this.topView = false; this.aiming = false; this.previewShown = false; this.previewDirty = true
    this.detach = this.keys.attach(window)
    controllerInput.setSport('golf')
    // The match's movement record. Ends with the match, or when the scene is left any other way.
    this.health = new HealthTracker('golf')
    this.badge?.destroy(); this.badge = healthBadge(this, this.health, 30, 96)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { void this.health.end(); this.badge?.destroy(); this.badge = null })
    controllerInput.clear('controller_1')
    this.pad = golfControllerState()
    this.input.keyboard!.on('keydown-ESC', () => this.togglePause())
    this.input.keyboard!.on('keydown-H', () => { if (!this.ended) this.togglePause() })
    this.input.keyboard!.on('keydown-Q', () => { if (this.paused) this.quit() })
    this.input.once('pointerdown', () => sfx.unlock())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown())
    const w = (window as unknown as { __golf?: GolfScene }); w.__golf = this
    void Engine3D.get().then((engine) => {
      if (!this.scene.isActive()) return
      engine.setQuality(loadSettings().quality)
      try {
        this.world = new GolfWorld(engine)
        this.world.show(this.scale.width, this.scale.height)
        this.world.apply(this.curr, this.aimState(), 0)
      } catch (err) { console.error('golf world failed', err); this.world = null }
      this.hud.clearCard()
      this.ready = true
      this.onEvent({ kind: 'wind', x: this.round.wind.x, z: this.round.wind.z })
    })
  }

  onResize(): void {
    this.hud.layout(this.scale.width, this.scale.height)
    this.world?.resize(this.scale.width, this.scale.height)
  }

  private togglePause(): void {
    if (this.ended) return
    this.paused = !this.paused
    if (this.paused) {
      sfx.back()
      this.hud.pauseOverlay(GOLF_HELP.map((h) => ({ keys: this.bindings[h.action].map(keyLabel).join(' / '), label: h.label, hint: h.hint })), [
        { label: 'RESUME', color: P.green, cb: () => this.togglePause() },
        { label: 'HOW TO PLAY', color: P.gold, cb: () => wipeTo(this, 'tutorial', { game: 'golf', from: 'menu' }) },
        { label: 'QUIT', color: P.red, cb: () => this.quit() },
      ])
    } else { sfx.select(); this.hud.clearOverlay() }
  }

  private quit(): void { wipeTo(this, 'menu') }

  /** Is the human on the shot right now? In practice both balls are the player's. */
  private myTurn(): boolean { return this.round.phase === 'aim' && (this.practice || this.round.current === 'a') }
  private mySurface(): Surface { return surfaceAt(this.round.holeData, this.round.balls[this.round.current].pos) }
  private headingToCup(p: Player): number {
    const b = this.round.balls[p].pos, c = this.round.holeData.cup
    return Math.atan2(c.x - b.x, c.z - b.z) * RAD
  }

  private aimState(): AimState {
    const mine = this.myTurn()
    return { heading: mine ? this.heading : this.headingToCup(this.round.current), putting: mine && this.club === 'putter', top: mine && this.topView }
  }

  /** Called when the player's aim phase begins: aim at the cup, pick a sensible club, reset the meter. */
  private beginAim(): void {
    const p = this.round.current
    this.heading = this.headingToCup(p)
    const surf = this.mySurface()
    const d = this.round.distanceToCup(p)
    this.club = suggestClub(surf, d)
    const allowed = allowedClubs(surf)
    if (!allowed.includes(this.club)) this.club = allowed[allowed.length - 1]
    this.meter.reset(); this.topView = false; this.previewDirty = true
  }

  private cycleClub(dir: 1 | -1): void {
    const allowed = allowedClubs(this.mySurface())
    const order = CLUB_LIST.filter((c) => allowed.includes(c))
    const i = Math.max(0, order.indexOf(this.club))
    const next = order[Math.max(0, Math.min(order.length - 1, i - dir))] // clubUp = longer = earlier in the list
    if (next === this.club) { sfx.back(); return }
    this.club = next; this.previewDirty = true; this.practiceUi.clubChanges++
    sfx.select()
  }

  private fire(): void {
    const r = this.meter.result()
    if (!r) return
    const shot = { club: this.club, aimDeg: this.heading, power: Math.max(0.05, Math.min(1, r.power)), accuracy: Math.max(-1, Math.min(1, r.accuracy)) }
    const before = this.round.events.length
    const ok = this.round.shoot(shot)
    this.meter.reset()
    if (!ok) { sfx.back(); this.hud.burst('NOT FROM HERE', P.orange, 46); return }
    // shoot() pushes onto the sim's event list outside step(), and the next step() clears it: drain the new ones now
    const fresh = this.round.events.slice(before)
    this.curr = this.round.snapshot()
    for (const e of fresh) this.onEvent(e)
    if (this.steps.length) this.practiceStep(fresh)
    this.aiming = false; this.topView = false
    this.world?.setPreview(null); this.previewShown = false
  }

  private updatePreview(now: number): void {
    const show = this.myTurn() && !!this.world
    if (!show) { if (this.previewShown) { this.world?.setPreview(null); this.previewShown = false } return }
    if (now - this.previewAt < PREVIEW_MS) return          // at most 10 recomputes per second
    if (!this.previewDirty && this.previewShown) return    // nothing changed since the last one
    this.previewAt = now; this.previewDirty = false
    try {
      const from = this.round.balls[this.round.current].pos
      const res = simulateShot(this.round.holeData, from, { club: this.club, aimDeg: this.heading, power: PREVIEW_POWER, accuracy: 0 }, this.round.wind, new Rng(1))
      this.world!.setPreview(res.trail); this.previewShown = true
    } catch { this.world?.setPreview(null); this.previewShown = false }
  }

  private scoreWord(strokes: number, par: number): [string, number] {
    const d = strokes - par
    if (strokes === 1) return ['HOLE IN ONE!', P.magenta]
    if (d <= -2) return ['EAGLE!', P.magenta]
    if (d === -1) return ['BIRDIE!', P.green]
    if (d === 0) return ['PAR', P.blue]
    if (d === 1) return ['BOGEY', P.orange]
    if (d === 2) return ['DOUBLE BOGEY', P.red]
    return [`${toParText(d)} · OUCH`, P.red]
  }

  private onEvent(e: GolfEvent): void {
    this.eventLog.push(JSON.stringify(e))
    const mine = 'player' in e && (e.player === 'a' || this.practice)
    const par = this.round.holeData.par
    switch (e.kind) {
      case 'wind': {
        const h = this.round.holeData, d = Math.round(Math.hypot(h.cup.x - h.tee.x, h.cup.z - h.tee.z))
        sfx.bell(1)
        this.hud.showCard(`HOLE ${this.round.hole + 1}`, P.gold, `par ${par} · ${d} m · wind ${Math.hypot(e.x, e.z).toFixed(1)} m/s`, 1600)
        break
      }
      case 'shot': sfx.whoosh(e.club !== 'putter' && e.power > 0.6); if (!mine) this.hud.burst(`${this.hud.names[1]}: ${CLUB_NAMES[e.club]}`, P.red, 40); break
      case 'bounce': if (e.surface !== 'green') sfx.thud(0.25); break
      case 'in_water': sfx.knockdown(); this.hud.burst('IN THE WATER', P.cyan, 64); break
      case 'out_of_bounds': sfx.stagger(); this.hud.burst('OUT OF BOUNDS', P.red, 64); break
      case 'on_green': if (mine) { sfx.sparkle(); this.hud.burst('ON THE GREEN', P.green, 50) } break
      case 'holed': {
        const [word, color] = this.scoreWord(e.strokes, par)
        if (mine) { sfx.win(); this.hud.burst('HOLED!', P.gold, 70); this.time.delayedCall(500, () => this.hud.burst(word, color, 64)) }
        else { sfx.count(); this.hud.burst(`${this.hud.names[1]}: ${word}`, color, 46) }
        break
      }
      case 'pick_up': sfx.gassed(); this.hud.burst(mine ? 'PICK UP' : `${this.hud.names[1]} PICKS UP`, P.orange, 52); break
      case 'hole_end': {
        const a = e.scores.a, b = e.scores.b
        this.hud.showCard(`HOLE ${e.hole + 1} DONE`, a < b ? P.green : a > b ? P.red : P.blue, `you ${a} (${toParText(a - par)}) · ${this.hud.names[1].toLowerCase()} ${b} (${toParText(b - par)})`, 1800)
        break
      }
      case 'round_end': this.time.delayedCall(600, () => this.finish()); break
      default: break
    }
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    const healthDone = this.health.end()
    void healthDone.then((line) => { if (line && this.scene.isActive()) this.hud.setHint(summaryLine(line)) })
    this.hud.clearCard(); this.world?.setPreview(null)
    const r = this.round.result(), sc = this.round.scorecard()
    const youWin = r?.winner === 'a'
    if (youWin) sfx.win()
    const lines = [
      `you ${sc.totals.a} (${toParText(sc.toPar.a)}) · ${this.hud.names[1].toLowerCase()} ${sc.totals.b} (${toParText(sc.toPar.b)})`,
      sc.holes.map((h) => `H${h.hole + 1} ${h.strokes.a}-${h.strokes.b}`).join('  ·  '),
      `seed ${this.round.seed}`,
    ]
    const perHole = sc.holes.map((h) => h.strokes.a), mean = perHole.length ? perHole.reduce((a, b) => a + b, 0) / perHole.length : 8
    const spread = perHole.length ? Math.sqrt(perHole.reduce((n, x) => n + (x - mean) ** 2, 0) / perHole.length) : 5
    const performance = Math.max(0, Math.min(1, .7 - sc.toPar.a * .08)), consistency = Math.max(0, Math.min(1, 1 - spread / 4))
    const next = () => { if (!this.data3.tempo) return this.scene.restart(this.data3); void healthDone.then((line) => { tempoFlow.addSegment('golf', line, performance, consistency); wipeTo(this, 'recovery') }) }
    const end = () => { if (!this.data3.tempo) return this.quit(); void healthDone.then((line) => { tempoFlow.addSegment('golf', line, performance, consistency); wipeTo(this, 'session-summary') }) }
    this.hud.result(youWin ? 'YOU WIN!' : r?.winner === 'draw' ? 'DRAW' : 'THE HOUSE WINS', lines, youWin ? P.green : r?.winner === 'draw' ? P.blue : P.red, next, end, this.data3.tempo ? ['RECOVER', 'END SESSION'] : undefined)
  }

  update(t: number, deltaMs: number): void {
    this.health.pump(); this.badge?.update()
    if (!this.ready) return
    const dtS = Math.min(deltaMs, 100) / 1000
    const inp = golfInput(this.keys, this.bindings)
    this.keys.endFrame()
    // Drained every frame, in or out of turn, so a swing thrown during the House's shot never waits in
    // the queue to fire the moment the player's turn begins. The keyboard wins any field it is using.
    const remote = controllerGolfCommand(controllerInput.stick('controller_1'), controllerInput.drain('controller_1', 'golf'), this.pad)
    this.pad = { clubArmed: remote.clubArmed }
    if (this.paused || this.ended) { this.world?.apply(this.curr, this.aimState(), dtS); this.hud.update(this.curr, this.hudState(), dtS); return }

    // player's aim phase
    if (this.myTurn()) {
      if (!this.aiming) { this.aiming = true; this.beginAim() }
      const club = inp.club !== 0 ? inp.club : remote.command.club
      const aim = inp.aim !== 0 ? inp.aim : remote.command.aim
      if (club !== 0) this.cycleClub(club)
      if (aim !== 0) {
        const d = aim * (this.club === 'putter' ? PUTT_AIM_RATE : AIM_RATE) * dtS
        this.heading += d; this.previewDirty = true; this.practiceUi.aimTurnedDeg += Math.abs(d)
      }
      if (inp.view) { this.topView = !this.topView; sfx.hover() }
      this.meter.update(dtS)
      if (inp.swing) {
        this.meter.press()
        if (this.meter.state === 'power') { sfx.hover(); this.practiceUi.swings++ } else if (this.meter.state === 'accuracy') sfx.select(); else if (this.meter.state === 'done') sfx.stamp()
      }
      // phone: A arms, B cancels, and an armed swing carries the power straight into the shot
      if (remote.command.arm && this.meter.state === 'idle') { this.meter.arm(); sfx.select(); this.hud.burst('ARMED · SWING', P.green, 40) }
      if (remote.command.cancel && this.meter.state === 'armed') { this.meter.cancel(); sfx.back() }
      if (remote.command.swingPower !== null && this.meter.fromSwing(remote.command.swingPower)) { sfx.stamp(); this.practiceUi.swings++ }
      if (this.meter.state === 'done') this.fire()
    } else this.aiming = false
    this.updatePreview(t)

    // fixed-step sim
    this.acc += Math.min(deltaMs, 100)
    let stepped = false
    while (this.acc >= STEP_MS) {
      this.prev = this.curr
      this.round.step()
      const events = this.round.events
      this.curr = this.round.snapshot()
      for (const e of events) this.onEvent(e)
      if (this.steps.length) this.practiceStep(events)
      stepped = true
      this.acc -= STEP_MS
    }
    if (!stepped && this.aiming) this.curr = this.round.snapshot()
    const view = lerpBalls(this.prev, this.curr, Math.min(1, this.acc / STEP_MS))
    this.world?.apply(view, this.aimState(), dtS)
    this.hud.update(view, this.hudState(), dtS)
  }

  private hudState() {
    return { club: this.club, heading: this.myTurn() ? this.heading : this.headingToCup(this.round.current), myTurn: this.myTurn(), meter: { state: this.meter.state, value: this.meter.value, power: this.meter.power, accuracy: this.meter.accuracy }, nHoles: this.nHoles }
  }

  /** Guided practice: advance the prompt when the current step's condition is met. */
  private practiceStep(events: GolfEvent[]): void {
    if (this.stepIx >= this.steps.length) return
    const step = this.steps[this.stepIx]
    const hit = events.length ? events.some((e) => step.done(e, this.curr, this.practiceUi)) : step.done(null, this.curr, this.practiceUi)
    if (this.guide.length === 0) this.drawGuide()
    if (!hit) return
    this.stepIx++
    sfx.sparkle(); this.hud.burst('NICE!', P.green, 50)
    this.drawGuide()
    if (this.stepIx >= this.steps.length) {
      this.time.delayedCall(800, () => {
        this.ended = true
        this.hud.result('READY TO PLAY', ['you know the swing', 'pick an opponent and go'], P.green, () => wipeTo(this, 'prefight', { game: 'golf', mode: '1p' }), () => this.quit(), ['PICK AN OPPONENT', 'BACK TO MENU'])
      })
    }
  }
  private drawGuide(): void {
    for (const o of this.guide) o.destroy()
    this.guide = []
    if (this.stepIx >= this.steps.length) return
    const W = this.scale.width
    this.guide.push(comicPanel(this, W / 2 - 300, 100, 600, 64, P.gold, 1).setDepth(105))
    this.guide.push(this.add.text(W / 2, 132, `${this.stepIx + 1}/${this.steps.length}  ${this.steps[this.stepIx].text}`, { fontFamily: DISPLAY, fontSize: '22px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(106).setAngle(1))
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
  }
}

/** Interpolate ball positions between two 120 Hz snapshots for a smooth frame. */
function lerpBalls(a: GolfSnapshot, b: GolfSnapshot, t: number): GolfSnapshot {
  if (a === b || a.hole !== b.hole || t >= 1) return b
  const mix = (p: Player) => {
    const pa = a.balls[p].pos, pb = b.balls[p].pos
    if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > 5) return b.balls[p] // teleport (drop, replay, new hole)
    return { ...b.balls[p], pos: { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t } }
  }
  return { ...b, balls: { a: mix('a'), b: mix('b') } }
}

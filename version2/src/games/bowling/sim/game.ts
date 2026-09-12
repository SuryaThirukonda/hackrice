import { AIM_SWAY, BALL_START_Z, BOT_CHARGE, BOT_DELAY, BOT_MAX_WAIT, FRAMES, FRAME_END_TICKS, JITTER, SETTLE_MAX, SETTLE_TICKS, SHOT_LIMITS, swayDeg } from './constants'
import { BowlingBot, clamp, releaseSpeed } from './bot'
import { anyMoving, isStanding, makePins, resolveContacts, stepBall, stepPins } from './physics'
import { frameDone, scoreFrames } from './scoring'
import { Rng } from '../../boxing/sim/rng'
import type { Ball, BallNo, BowlingEvent, GameConfig, Phase, Pin, Scoreboard, Shot, Side, Snapshot } from './types'

/** Deterministic two-player ten-pin game: fixed 120 Hz steps, integer-tick timers, one seeded RNG. */
export class BowlingGame {
  readonly rng: Rng
  botA: BowlingBot | null
  botB: BowlingBot | null
  phase: Phase = 'aim'
  current: Side = 'a'
  frame = 1
  ball: BallNo = 1
  tick = 0
  phaseT = 0
  pins: Pin[] = makePins()
  ballBody: Ball = { x: 0, z: BALL_START_Z, vx: 0, vz: 0, hook: 0, gutter: false, moving: false }
  events: BowlingEvent[] = []
  rolls: Record<Side, number[][]> = { a: [], b: [] }
  private standingAtRoll = 10
  private result: Side | 'draw' | null = null
  private botShot: Shot | null = null
  private botWait = 0
  private botCharge = 0
  private swayLocked: number | null = null

  constructor(cfg: GameConfig) {
    this.rng = new Rng(cfg.seed)
    this.botA = cfg.botA ? new BowlingBot(cfg.botA) : null
    this.botB = cfg.botB ? new BowlingBot(cfg.botB) : null
    this.enterAim()
  }

  bot(side: Side = this.current): BowlingBot | null { return side === 'a' ? this.botA : this.botB }
  standingPins(): Pin[] { return this.pins.filter(isStanding) }
  scoreboard(): Record<Side, Scoreboard> { return { a: scoreFrames(this.rolls.a), b: scoreFrames(this.rolls.b) } }
  winner(): Side | 'draw' | null { return this.result }

  /** Degrees the aim line is swayed right now; frozen once locked. Applied to every release, human or bot. */
  sway(): number { return this.swayLocked ?? swayDeg(this.tick) }
  get locked(): boolean { return this.swayLocked !== null }
  /** Stop the sweeping line where it is (first Space press). Only in the aim phase, once per turn. */
  lockSway(): boolean {
    if (this.phase !== 'aim' || this.swayLocked !== null) return false
    this.swayLocked = swayDeg(this.tick)
    return true
  }

  private enterAim(): void {
    this.phase = 'aim'; this.phaseT = BOT_DELAY; this.botShot = null; this.botWait = 0; this.botCharge = 0; this.swayLocked = null
    this.ballBody = { x: 0, z: BALL_START_Z, vx: 0, vz: 0, hook: 0, gutter: false, moving: false }
  }

  private rack(): void { this.pins = makePins() }

  /** Release the ball. Only valid in the aim phase. Small seeded release jitter is added to every shot. */
  startRoll(shot: Shot): boolean {
    if (this.phase !== 'aim') return false
    const lanePos = clamp(shot.lanePos, -SHOT_LIMITS.lanePos, SHOT_LIMITS.lanePos) + this.rng.range(-JITTER.lanePos, JITTER.lanePos)
    const sway = this.sway()
    const angleDeg = clamp(shot.angleDeg + sway, -SHOT_LIMITS.angleDeg - AIM_SWAY.ampDeg, SHOT_LIMITS.angleDeg + AIM_SWAY.ampDeg) + this.rng.range(-JITTER.angleDeg, JITTER.angleDeg)
    const power = clamp(shot.power, 0, 1) + this.rng.range(-JITTER.power, JITTER.power)
    const speed = releaseSpeed(power), a = (angleDeg * Math.PI) / 180
    this.ballBody = { x: lanePos, z: BALL_START_Z, vx: speed * Math.sin(a), vz: speed * Math.cos(a), hook: clamp(shot.hook, -1, 1), gutter: false, moving: true }
    this.standingAtRoll = this.standingPins().length
    this.phase = 'rolling'
    this.events.push({ kind: 'roll_start', player: this.current, frame: this.frame, ball: this.ball, shot: { ...shot }, sway })
    return true
  }

  /** Advance one tick. Bots roll on their own after a short delay in the aim phase. */
  step(): void {
    this.events = []; this.tick++
    switch (this.phase) {
      case 'aim': {
        const bot = this.bot()
        if (!bot) break
        if (--this.phaseT > 0) break
        // the bot has decided; it now waits for the sway to come near the centre (as far as its timing skill allows)
        if (!this.botShot) this.botShot = bot.decide(this.standingPins(), this.frame, this.ball, this.rng)
        if (this.swayLocked === null) {
          this.botWait++
          if (Math.abs(this.sway()) <= bot.releaseTolerance(AIM_SWAY.ampDeg) || this.botWait >= BOT_MAX_WAIT) this.lockSway()
        } else if (++this.botCharge >= BOT_CHARGE) this.startRoll(this.botShot) // same two-step release as the human
        break
      }
      case 'rolling':
        this.physics()
        if (!this.ballBody.moving) { this.phase = 'settle'; this.phaseT = 0 }
        break
      case 'settle':
        this.physics(); this.phaseT++
        if ((this.phaseT >= SETTLE_TICKS && !anyMoving(this.ballBody, this.pins)) || this.phaseT >= SETTLE_MAX) this.endRoll()
        break
      case 'frame_end':
        if (--this.phaseT <= 0) this.nextTurn()
        break
      default: break
    }
  }

  private physics(): void {
    stepBall(this.ballBody, this.events)
    stepPins(this.pins)
    if (anyMoving(this.ballBody, this.pins)) resolveContacts(this.ballBody, this.pins, this.events)
  }

  private endRoll(): void {
    const standingNow = this.standingPins().length
    const knocked = this.standingAtRoll - standingNow
    const r = this.rolls[this.current]
    if (r.length < this.frame) r.push([])
    const fr = r[this.frame - 1]
    fr.push(knocked)
    this.events.push({ kind: 'pins_down', count: knocked })
    if (this.standingAtRoll === 10 && knocked === 10) this.events.push({ kind: 'strike', player: this.current })
    else if (this.standingAtRoll < 10 && standingNow === 0) this.events.push({ kind: 'spare', player: this.current })
    for (const p of this.pins) { if (p.down) p.removed = true; p.vx = 0; p.vz = 0 }
    if (frameDone(this.frame, fr)) {
      this.phase = 'frame_end'; this.phaseT = FRAME_END_TICKS
      this.events.push({ kind: 'frame_end', player: this.current, frame: this.frame, score: scoreFrames(r).total })
      return
    }
    this.ball = (this.ball + 1) as BallNo
    if (standingNow === 0) this.rack()
    this.enterAim()
  }

  private nextTurn(): void {
    if (this.current === 'b' && this.frame === FRAMES) {
      const totals = { a: scoreFrames(this.rolls.a).total, b: scoreFrames(this.rolls.b).total }
      this.result = totals.a > totals.b ? 'a' : totals.b > totals.a ? 'b' : 'draw'
      this.phase = 'game_end'
      this.events.push({ kind: 'game_end', winner: this.result, totals })
      return
    }
    if (this.current === 'b') this.frame++
    this.current = this.current === 'a' ? 'b' : 'a'
    this.ball = 1
    this.rack(); this.enterAim()
  }

  snapshot(): Snapshot {
    const b = this.ballBody
    return {
      tick: this.tick, phase: this.phase, current: this.current, frame: this.frame, ball: this.ball,
      ballPos: { x: b.x, z: b.z }, ballVel: { x: b.vx, z: b.vz }, gutter: b.gutter,
      pins: this.pins.filter((p) => !p.removed).map((p) => ({ index: p.index, x: p.x, z: p.z, standing: isStanding(p), down: p.down })),
      standing: this.standingPins().length, scoreboard: this.scoreboard(), sway: this.sway(), swayLocked: this.swayLocked !== null,
    }
  }
}

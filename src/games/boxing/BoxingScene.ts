import Phaser from 'phaser'
import { HealthTracker, summaryLine } from '../../health/tracker'
import { healthBadge } from '../../health/liveBadge'
import { Engine3D } from '../../engine3d/Engine3D'
import { sfx } from '../../fx/sfx'
import { controllerInput } from '../../input/controller'
import { wipeTo } from '../../fx/transitions'
import { KeyState } from '../../input/keys'
import { P } from '../../theme'
import { BOXING_HELP, BOXING_KEYS, boxingCommand, boxingControllerState, controllerBoxingCommand, heldOnly, keyLabel, type BoxingBindings } from './keymap'
import { boxingPractice, type PracticeStep } from './tutorial'
import { loadSettings } from '../../agent/sliders'
import { comicPanel } from '../../ui/widgets'
import { DISPLAY, HEX } from '../../theme'
import { AgentLink } from '../../agent/AgentLink'
import { Book, type Corner, type Form } from '../../betting/book'
import { loadChips, loadRecord, saveChips, saveRecord } from '../../scenes/FightNightScene'
import { BoxingHud } from './hud/BoxingHud'
import { BoxingWorld } from './render/BoxingWorld'
import { lerpView } from './render/interp'
import { BoxingMatch } from './sim/match'
import { TIERS } from './sim/tiers'
import { HZ } from './sim/constants'
import type { BotParams, Command, SimEvent, Snapshot } from './sim/types'

export interface Persona { name: string; style: string; color: number }
export interface BoxingSceneData { mode?: '1p' | 'card'; tier?: keyof typeof TIERS; bot?: BotParams; seed?: number; practice?: boolean; personas?: [Persona, Persona] }

const STEP_MS = 1000 / HZ

/** First-person 3D boxing: Phaser owns input and simulation; PlayCanvas renders behind it. */
export class BoxingScene extends Phaser.Scene {
  private data3!: BoxingSceneData
  private pad = boxingControllerState()
  private match!: BoxingMatch
  private hud!: BoxingHud
  private world: BoxingWorld | null = null
  private keys = new KeyState()
  private detach: (() => void) | null = null
  private acc = 0
  private hitStop = 0
  private prev!: Snapshot
  private curr!: Snapshot
  private paused = false
  private ended = false
  private health!: HealthTracker
  private badge: { update: () => void; destroy: () => void } | null = null
  private ready = false
  private startedAt = 0
  private eventLog: string[] = []
  private bindings: BoxingBindings = BOXING_KEYS
  private steps: PracticeStep[] = []
  private stepIx = 0
  private guide: Phaser.GameObjects.GameObject[] = []
  // Fight Night (card mode)
  private link: AgentLink | null = null
  private book: Book | null = null
  private betting = false
  private betCorner: Corner = 'a'
  private betStake = 50
  private betLeft = 0
  private betPlaced: string | null = null
  private betMarket = ''
  private roundsWon: [number, number] = [0, 0]

  constructor() { super('boxing') }

  private get card(): boolean { return this.data3.mode === 'card' }

  init(d: BoxingSceneData): void { this.data3 = d ?? {} }

  create(): void {
    const d = this.data3
    const seed = d.seed ?? Math.floor(Math.random() * 1e9)
    const bot = d.practice ? null : (d.bot ?? TIERS[d.tier ?? 'rookie'])
    this.match = new BoxingMatch({ seed, botB: d.mode === 'card' ? TIERS.pro : bot, botA: d.mode === 'card' ? TIERS.pro : null })
    this.prev = this.curr = this.match.snapshot()
    // class fields outlive scene restarts: clear everything that belongs to a previous fight (a Fight Night link must not drive a 1P match)
    this.link = null; this.book = null; this.betting = false; this.betPlaced = null; this.betMarket = ''; this.betLeft = 0; this.roundsWon = [0, 0]; this.stepIx = 0; this.guide = []
    const settings = loadSettings()
    sfx.enabled = settings.sound
    this.bindings = { ...BOXING_KEYS, ...(settings.bindings.boxing as Partial<BoxingBindings> | undefined) }
    this.steps = d.practice ? boxingPractice(this.bindings) : []
    this.stepIx = 0
    this.hud = new BoxingHud(this)
    this.hud.names = ['YOU', d.practice ? 'SPARRING DUMMY' : `THE HOUSE (${(d.tier ?? 'rookie').toUpperCase()})`]
    if (this.card) {
      const ps = d.personas ?? [{ name: 'Blue', style: 'a brawler', color: P.blue }, { name: 'Red', style: 'a counter-puncher', color: P.red }]
      this.hud.names = [ps[0].name, ps[1].name]
      this.link = new AgentLink([`${ps[0].name}, ${ps[0].style}`, `${ps[1].name}, ${ps[1].style}`])
      this.link.onTaunt = (side, text) => this.hud.taunt(side, text)
      this.book = new Book(loadChips())
      this.roundsWon = [0, 0]
    }
    this.hud.layout(this.scale.width, this.scale.height)
    this.hud.showCard('LOADING RING', P.gold, `seed ${seed}`, 0)
    this.acc = 0; this.hitStop = 0; this.paused = false; this.ended = false; this.ready = false; this.eventLog = []
    this.detach = this.keys.attach(window)
    this.input.keyboard!.on('keydown-ESC', () => this.togglePause())
    this.input.keyboard!.on('keydown-H', () => { if (!this.ended) this.togglePause() })
    this.input.keyboard!.on('keydown-Q', () => { if (this.paused) this.quit() })
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.betKey(e.code))
    this.input.once('pointerdown', () => sfx.unlock())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown())
    const w = (window as unknown as { __boxing?: BoxingScene }); w.__boxing = this
    // Phaser reuses scene instances, so the pad latch and any queued phone events must be reset per visit.
    this.pad = boxingControllerState()
    controllerInput.setSport('boxing')
    // The match's movement record. Ends with the match, or when the scene is left any other way.
    this.health = new HealthTracker('boxing')
    this.badge?.destroy(); this.badge = healthBadge(this, this.health, 30, 96)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { void this.health.end(); this.badge?.destroy(); this.badge = null })
    controllerInput.clear('controller_1')
    void Engine3D.get().then((engine) => {
      if (!this.scene.isActive()) return
      engine.setQuality(loadSettings().quality)
      this.world = new BoxingWorld(engine, P.red, this.card)
      this.world.show(this.scale.width, this.scale.height)
      this.hud.clearCard()
      this.ready = true
      this.startedAt = this.time.now
      this.world.apply(this.curr, 0, false)
      if (this.card) { this.hud.setHint('spectating · A/D corner · ↑↓ stake · Enter bet · Esc pause'); this.link?.strategize(this.match); this.openBetting('match') }
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
      this.hud.pauseOverlay(BOXING_HELP.map((h) => ({ keys: this.bindings[h.action].map(keyLabel).join(' / '), label: h.label, hint: h.hint })), [
        { label: 'RESUME', color: P.green, cb: () => this.togglePause() },
        { label: 'HOW TO PLAY', color: P.gold, cb: () => wipeTo(this, 'tutorial', { game: 'boxing', from: 'menu' }) },
        { label: 'QUIT', color: P.red, cb: () => this.quit() },
      ])
    } else { sfx.select(); this.hud.clearOverlay() }
  }

  private quit(): void { wipeTo(this, 'menu') }

  private onEvent(e: SimEvent): void {
    this.eventLog.push(JSON.stringify(e))
    const w = this.world
    switch (e.kind) {
      case 'countdown': sfx.countdown(e.n); this.hud.countdownNumber(e.n); break
      case 'bell':
        sfx.bell(e.end ? 2 : 1); w?.cheer()
        if (!e.end) { this.hud.showCard(`ROUND ${e.round}`, P.gold, 'fight!', 700) } else this.hud.showCard('ROUND OVER', P.blue, `round ${e.round}`, 1400)
        if (e.end && this.card) {
          const w = this.roundWinner()
          if (w === 'a') this.roundsWon[0]++; else if (w === 'b') this.roundsWon[1]++
          if (this.book?.markets.some((m) => m.id === `round${e.round}` && !m.settled)) this.settle(`round${e.round}`, w)
          if (e.round < this.match.rounds) { this.link?.strategize(this.match); this.time.delayedCall(1500, () => { if (!this.ended) this.openBetting('round') }) }
        }
        break
      case 'windup': sfx.whoosh(e.punch === 'cross'); break
      case 'punch': {
        const mine = e.who === 'a'
        if (e.result === 'hit') {
          sfx.thud(e.punch === 'cross' ? 1 : 0.7); w?.cheer(); w?.hitFx(this.curr, mine ? 'b' : 'a', e.punch === 'cross')
          if (mine) { this.hud.burst(undefined, e.punch === 'cross' ? P.red : P.gold, e.punch === 'cross' ? 84 : 64); w?.punchKick(); w?.shake(0.35); this.hitStop = 60 }
          else { this.hud.hitFlash(e.punch === 'cross' ? 0.45 : 0.28); w?.shake(e.punch === 'cross' ? 1 : 0.6); this.hitStop = 100 }
        } else if (e.result === 'blocked') { sfx.block(); this.hud.burst('BLOCK', P.blue, 44); w?.shake(0.2) }
        else if (e.result === 'dodged') { sfx.dodge(); this.hud.burst('MISS', P.cyan, 44) }
        break
      }
      case 'stagger': sfx.stagger(); if (e.who === 'b') this.hud.burst('STAGGER!', P.orange, 60); break
      case 'guard_break': sfx.parry(); this.hud.burst('GUARD BREAK!', P.magenta, 60); w?.guardBreakFx(this.curr, e.who); break
      case 'gassed': if (e.who === 'a') { sfx.gassed(); this.hud.gassed() } break
      case 'knockdown':
        sfx.knockdown(); w?.shake(1.4); this.hitStop = 250; w?.knockdownFx(this.curr, e.who); w?.cheer()
        this.hud.showCard(e.who === 'b' ? 'DOWN!' : 'YOU ARE DOWN!', e.who === 'b' ? P.gold : P.red, e.ko ? 'that looks final' : 'get up before ten', 1200)
        break
      case 'count':
        sfx.count()
        this.hud.knockdownCount(e.n, e.who)
        break
      case 'getup':
        sfx.bell(1)
        this.hud.clearKnockdownCount()
        this.hud.showCard('UP!', P.green, 'back to it', 600)
        break
      case 'ko':
        sfx.ko()
        w?.cheer()
        this.hud.clearKnockdownCount()
        this.hud.showCard('K.O.!', P.magenta, e.who === 'b' ? `${this.hud.names[1]} goes down` : `${this.hud.names[0]} goes down`, 0)
        this.time.delayedCall(1800, () => this.finish())
        break
      case 'decision': sfx.bell(3); this.time.delayedCall(600, () => this.finish()); break
      default: break
    }
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    void this.health.end().then((line) => { if (line && this.scene.isActive()) this.hud.setHint(summaryLine(line)) })
    this.hud.clearCard()
    this.hud.clearKnockdownCount()
    const r = this.match.getResult()
    const youWin = r?.winner === 'a'
    const m = this.match
    if (this.card && r) {
      if (r.by === 'ko') { const rid = `round${r.round}`; if (this.book?.markets.some((x) => x.id === rid && !x.settled)) this.book.settle(rid, r.winner) }
      this.settle('match1', r.winner)
      if (this.book) {
        const rec = loadRecord(); rec.fights++; rec.won += this.book.won; rec.lost += this.book.lost; rec.net += this.book.net; rec.best = Math.max(rec.best, this.book.balance); saveRecord(rec); saveChips(this.book.balance)
        this.time.delayedCall(2000, () => {
          this.hud.result(r.winner === 'draw' ? 'DRAW' : `${this.hud.names[r.winner === 'a' ? 0 : 1].toUpperCase()} WINS`, [
            `${r.by === 'ko' ? `by knockout in round ${r.round}` : r.by === 'decision' ? 'on points' : 'a draw'}`,
            `bets: won ${this.book!.won} · lost ${this.book!.lost} · net ${this.book!.net >= 0 ? '+' : ''}${this.book!.net}`,
            `chips ${this.book!.balance}`,
          ], r.winner === 'a' ? P.blue : P.red, () => wipeTo(this, 'fightnight'), () => this.quit(), ['ANOTHER FIGHT', 'BACK TO MENU'])
        })
      }
      return
    }
    if (youWin) { sfx.win(); this.world?.confetti() }
    const lines = [
      `${r?.by === 'ko' ? 'by knockout' : r?.by === 'decision' ? 'on points' : 'a draw'}${r?.by === 'ko' ? ` in round ${r.round}` : ''}`,
      `you: ${m.a.landed}/${m.a.thrown} landed · ${Math.round(m.a.dealtTotal)} damage`,
      `house: ${m.b.landed}/${m.b.thrown} landed · ${Math.round(m.b.dealtTotal)} damage`,
      `seed ${m.seedValue}`,
    ]
    this.hud.result(youWin ? 'YOU WIN!' : r?.winner === 'draw' ? 'DRAW' : 'THE HOUSE WINS', lines, youWin ? P.green : P.red, () => this.scene.restart(this.data3), () => this.quit())
  }

  update(_t: number, deltaMs: number): void {
    this.health.pump(); this.badge?.update()
    if (!this.ready || !this.world) return
    const keyboard = boxingCommand(this.keys, this.bindings)
    this.keys.endFrame()
    // Keyboard, phone, and head tracker drive the same match. Every field takes the keyboard first,
    // falls through to the phone, then to the head tracker.
    const remote = controllerBoxingCommand(controllerInput.stick('controller_1'), controllerInput.drain('controller_1', 'boxing'), this.pad, controllerInput.connected('controller_1'))
    this.pad = { blocking: remote.blocking, slipArmed: remote.slipArmed }

    const headEvents = controllerInput.drain('head_tracker', 'boxing')
    let headDodge: Command['dodge'] = null
    for (const ev of headEvents) {
      if (ev.kind === 'action') {
        if (ev.action === 'duck' || ev.action === 'emergency_power') headDodge = 'duck'
        else if (ev.action === 'sway_left') headDodge = 'swayL'
        else if (ev.action === 'sway_right') headDodge = 'swayR'
      }
    }

    const c = {
      ...keyboard,
      forward: keyboard.forward || remote.command.forward,
      block: keyboard.block || remote.command.block,
      punch: keyboard.punch ?? remote.command.punch,
      dodge: keyboard.dodge ?? remote.command.dodge ?? headDodge,
      // the power must follow whichever source actually threw, or a keyboard jab inherits the phone's swing
      punchPower: keyboard.punch !== null ? undefined : remote.command.punchPower,
    }
    // Visual indicators for remote actions
    if (keyboard.punch === null && remote.command.punch !== null && !this.paused && !this.ended && !this.betting) this.hud.phonePunch()
    if (headDodge !== null && keyboard.dodge === null && remote.command.dodge === null && !this.paused && !this.ended && !this.betting) {
      const label = headDodge === 'duck' ? 'HEAD DUCK!' : headDodge === 'swayL' ? 'HEAD SLIP ◀' : 'HEAD SLIP ▶'
      this.hud.burst(label, P.cyan, 44)
    }
    if (this.paused || this.ended) { this.world.apply(this.curr, deltaMs / 1000, this.match.a.hp <= 0); this.hud.update(this.curr, deltaMs / 1000); return }
    if (this.betting) {
      this.betLeft -= deltaMs / 1000
      if (this.betLeft <= 0) this.closeBetting(); else if (Math.ceil(this.betLeft + deltaMs / 1000) !== Math.ceil(this.betLeft)) this.drawBet()
      this.world.apply(this.curr, deltaMs / 1000, false); this.hud.update(this.curr, deltaMs / 1000); return
    }
    if (this.link && this.match.phase === 'fighting') {
      this.link.tick(this.match, this.time.now)
      const ca = this.link.corners.a, cb = this.link.corners.b
      const fmt = (x: typeof ca) => (x.lastSource === 'none' ? 'thinking…' : `${x.lastSource === 'llm' ? 'LLM' : 'script'} ${x.lastLatency} ms${x.inflight ? ' · thinking…' : ''}`) + (x.plan ? ` · plan: ${x.plan.slice(0, 48)}${x.plan.length > 48 ? '…' : ''}` : '')
      this.hud.cornerStatus(fmt(ca), fmt(cb))
    }
    let dt = Math.min(deltaMs, 100)
    if (this.hitStop > 0) { this.hitStop -= dt; dt = 0 }
    this.acc += dt
    let first = true
    while (this.acc >= STEP_MS) {
      this.prev = this.curr
      if (this.link) {
        const t = this.match.tick
        const ea = this.link.corners.a.exec, eb = this.link.corners.b.exec
        this.match.step(ea.isLate(t) ? null : ea.command(t), eb.isLate(t) ? null : eb.command(t))
        this.link.noteEvents(this.match.events)
      } else this.match.step(first ? c : heldOnly(c))
      first = false
      this.curr = this.match.snapshot()
      for (const e of this.match.events) this.onEvent(e)
      if (this.steps.length) this.practice(this.match.events)
      this.acc -= STEP_MS
      if (this.hitStop > 0) { this.acc = 0; break }
    }
    const view = lerpView(this.prev, this.curr, Math.min(1, this.acc / STEP_MS))
    this.world.apply(view, deltaMs / 1000, this.match.a.hp <= 0 && this.match.phase !== 'fighting')
    this.hud.update(view, deltaMs / 1000)
  }

  private form(): Form {
    const a = this.match.a, b = this.match.b
    return { hpA: a.hp, hpB: b.hp, staA: a.stamina, staB: b.stamina, kdA: a.kdTotal, kdB: b.kdTotal, roundsWonA: this.roundsWon[0], roundsWonB: this.roundsWon[1] }
  }
  private openBetting(kind: 'match' | 'round'): void {
    if (!this.book) return
    const m = this.book.openMarket(kind, this.match.round, this.form())
    this.betMarket = m.id; this.betting = true; this.betLeft = 15; this.betPlaced = null
    this.betStake = Math.min(this.betStake, Math.max(10, this.book.balance))
    this.drawBet()
  }
  private drawBet(): void {
    if (!this.book) return
    const m = this.book.markets.find((x) => x.id === this.betMarket)!
    this.hud.betPanel({ round: this.match.round, odds: m.odds, names: this.hud.names, corner: this.betCorner, stake: this.betStake, balance: this.book.balance, kind: m.kind, secondsLeft: Math.ceil(this.betLeft), placed: this.betPlaced })
  }
  private betKey(code: string): void {
    if (!this.betting || !this.book) return
    if (code === 'KeyA' || code === 'ArrowLeft') this.betCorner = 'a'
    else if (code === 'KeyD' || code === 'ArrowRight') this.betCorner = 'b'
    else if (code === 'ArrowUp') this.betStake = Math.min(this.book.balance, this.betStake + 10)
    else if (code === 'ArrowDown') this.betStake = Math.max(10, this.betStake - 10)
    else if (code === 'Enter') {
      const r = this.book.place(this.betMarket, this.betCorner, this.betStake)
      this.betPlaced = r.ok ? `${this.betStake} on ${this.hud.names[this.betCorner === 'a' ? 0 : 1]}` : r.reason ?? 'no'
      if (r.ok) { sfx.stamp(); saveChips(this.book.balance); this.time.delayedCall(700, () => this.closeBetting()) } else sfx.back()
    } else if (code === 'Space') { this.closeBetting(); return }
    else return
    sfx.hover(); this.drawBet()
  }
  private closeBetting(): void { if (!this.betting) return; this.betting = false; this.book?.closeMarkets(); this.hud.clearBet() }
  private settle(id: string, winner: Corner | 'draw'): void {
    if (!this.book) return
    const r = this.book.settle(id, winner)
    saveChips(this.book.balance)
    if (r.bets.length) {
      const paid = r.paid
      this.hud.showCard(paid > 0 ? `+${paid} CHIPS` : 'BET LOST', paid > 0 ? P.green : P.red, `${this.hud.names[winner === 'a' ? 0 : 1]} ${winner === 'draw' ? 'draw, refunded' : 'takes it'} · balance ${this.book.balance}`, 1800)
      if (paid > 0) sfx.win()
    }
  }
  private roundWinner(): Corner | 'draw' {
    const a = this.match.a.dealtRound, b = this.match.b.dealtRound
    return a > b ? 'a' : b > a ? 'b' : 'draw'
  }

  /** Guided practice: advance the prompt when the current step's condition is met. */
  private practice(events: SimEvent[]): void {
    if (this.stepIx >= this.steps.length) return
    const step = this.steps[this.stepIx]
    const hit = events.length ? events.some((e) => step.done(e, this.curr)) : step.done(null, this.curr)
    if (this.guide.length === 0) this.drawGuide()
    if (!hit) return
    this.stepIx++
    sfx.sparkle(); this.hud.burst('NICE!', P.green, 50)
    this.drawGuide()
    if (this.stepIx >= this.steps.length) {
      this.time.delayedCall(800, () => {
        this.ended = true
        this.hud.result('READY TO FIGHT', ['you know every move', 'pick an opponent and go'], P.green, () => wipeTo(this, 'prefight', { game: 'boxing', mode: '1p' }), () => this.quit(), ['PICK AN OPPONENT', 'BACK TO MENU'])
      })
    }
  }
  private drawGuide(): void {
    for (const o of this.guide) o.destroy()
    this.guide = []
    if (this.stepIx >= this.steps.length) return
    const W = this.scale.width
    this.guide.push(comicPanel(this, W / 2 - 300, 100, 600, 64, P.gold, 1).setDepth(105))
    this.guide.push(this.add.text(W / 2, 132, `${this.stepIx + 1}/${this.steps.length}  ${this.steps[this.stepIx].text}`, { fontFamily: DISPLAY, fontSize: '24px', color: HEX(P.ink) }).setOrigin(0.5).setDepth(106).setAngle(1))
  }

  /** Dev/test hooks: the event log so replays can be compared, and the live snapshot. */
  getEventLog(): string[] { return this.eventLog }
  getSnapshot(): Snapshot { return this.curr }

  private shutdown(): void {
    this.detach?.(); this.detach = null
    this.input.keyboard?.removeAllListeners()
    controllerInput.clear()
    this.world?.hide()
    this.hud.destroy()
    this.world = null
    void this.startedAt
  }
}

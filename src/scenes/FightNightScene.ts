import Phaser from 'phaser'
import { ComicBackdrop, ComicButton, comicPanel, ensureTextures, MenuNav } from '../ui/widgets'
import { DISPLAY, FONT, HEX, P } from '../theme'
import { wipeTo } from '../fx/transitions'
import { sfx } from '../fx/sfx'
import { Book, START_CHIPS } from '../betting/book'
import { fetchChipSummary, startingChips } from '../betting/ledger'
import { Announcer, LOBBY_CAPTIONS } from '../announcer'

export const PERSONAS: import('../games/boxing/BoxingScene').Persona[] = [
  { name: 'Knuckles McGraw', model: 'pro', style: 'a relentless brawler who walks forward and throws heavy crosses', color: P.red },
  { name: 'The Professor', model: 'alien', style: 'a patient counter-puncher who blocks, dodges, and punishes mistakes', color: P.blue },
  { name: 'Lucky Lou', model: 'lizard', style: 'a flashy showboat who sways a lot and taunts constantly', color: P.gold },
  { name: 'Iron Maggie', model: 'robot', style: 'a stamina monster who never stops jabbing', color: P.green },
]
export const CHIPS_KEY = 'hap.v2.chips'
export function loadChips(): number { try { const v = Number(localStorage.getItem(CHIPS_KEY)); return Number.isFinite(v) && v > 0 ? v : START_CHIPS } catch { return START_CHIPS } }
export function saveChips(n: number): void { try { localStorage.setItem(CHIPS_KEY, String(n)) } catch { /* ignore */ } }
export const RECORD_KEY = 'hap.v2.record'
export interface BetRecord { fights: number; won: number; lost: number; net: number; best: number }
const EMPTY_RECORD: BetRecord = { fights: 0, won: 0, lost: 0, net: 0, best: 0 }
export function loadRecord(): BetRecord { try { const r = JSON.parse(localStorage.getItem(RECORD_KEY) ?? '') as Partial<BetRecord>; return { ...EMPTY_RECORD, ...r } } catch { return { ...EMPTY_RECORD } } }
export function saveRecord(r: BetRecord): void { try { localStorage.setItem(RECORD_KEY, JSON.stringify(r)) } catch { /* ignore */ } }

/** Fight Night lobby: two LLM agents fight each other; you bet play chips. Pick the corners, check the agent service, start. */
export class FightNightScene extends Phaser.Scene {
  private city!: ComicBackdrop
  private pick: [number, number] = [0, 1]
  private row = 0
  private content: Phaser.GameObjects.GameObject[] = []
  private health = 'checking the agent service…'
  constructor() { super('fightnight') }
  init(): void { this.row = 0 }
  create(): void {
    ensureTextures(this)
    this.city = new ComicBackdrop(this, 55)
    const kb = this.input.keyboard!
    kb.on('keydown-DOWN', () => { this.row = (this.row + 1) % 3; sfx.hover(); this.draw() })
    kb.on('keydown-UP', () => { this.row = (this.row + 2) % 3; sfx.hover(); this.draw() })
    kb.on('keydown-LEFT', () => this.cycle(-1)); kb.on('keydown-RIGHT', () => this.cycle(1))
    kb.on('keydown-ENTER', () => (this.row === 2 ? this.start() : this.cycle(1)))
    kb.on('keydown-ESC', () => wipeTo(this, 'menu'))
    void fetch('/agent/health').then((r) => r.json()).then((h: { model: string; source: string; detail: string }) => { this.health = `agents: ${h.source === 'llm' ? `live (${h.model})` : 'offline, scripted fallback'}`; this.draw() }).catch(() => { this.health = 'agent service not running: scripted fallback (npm run agent)'; this.draw() })
    this.draw()
    Announcer.once(this, 'card.lobby', LOBBY_CAPTIONS)
  }
  private cycle(d: number): void {
    if (this.row > 1) return
    const other = this.pick[1 - this.row]
    let n = this.pick[this.row]
    do { n = (n + d + PERSONAS.length) % PERSONAS.length } while (n === other)
    this.pick[this.row] = n; sfx.hover(); this.draw()
  }
  private start(): void {
    sfx.select()
    wipeTo(this, 'boxing', { mode: 'card', personas: [PERSONAS[this.pick[0]], PERSONAS[this.pick[1]]], seed: Math.floor(Math.random() * 1e9) })
  }
  private draw(): void {
    for (const o of this.content) o.destroy()
    this.content = []
    const { width: W, height: H } = this.scale
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.content.push(o); return o }
    add(comicPanel(this, W / 2 - 420, 40, 840, H - 80, P.paper, 1))
    add(new ComicButton(this, 90, 48, '◀ BACK', () => { sfx.back(); wipeTo(this, 'menu') }, { color: P.blue, w: 110, h: 42, size: 16 }))
    add(this.add.text(W / 2, 92, 'FIGHT NIGHT', { fontFamily: DISPLAY, fontSize: '54px', color: HEX(P.red), stroke: HEX(P.ink), strokeThickness: 8 }).setOrigin(0.5).setAngle(1))
    add(this.add.text(W / 2, 140, 'two AI fighters, one ring, your chips on the line', { fontFamily: FONT, fontSize: '18px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    for (const i of [0, 1]) {
      const y = 215 + i * 120, p = PERSONAS[this.pick[i]]
      add(this.add.text(W / 2 - 370, y - 8, i === 0 ? 'BLUE CORNER' : 'RED CORNER', { fontFamily: DISPLAY, fontSize: '22px', color: HEX(this.row === i ? P.red : P.ink) }).setOrigin(0, 0.5))
      add(new ComicButton(this, W / 2 + 40, y, `◀  ${p.name}  ▶`, () => { this.row = i; this.cycle(1) }, { color: this.row === i ? P.gold : i === 0 ? P.blue : P.red, w: 520, h: 56, size: 26 }))
      add(this.add.text(W / 2 + 40, y + 46, p.style, { fontFamily: FONT, fontSize: '15px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    }
    const rec = loadRecord()
    const line = add(this.add.text(W / 2, 470, `chips ${loadChips()}  ·  fights ${rec.fights}  ·  bets won ${rec.won} lost ${rec.lost}  ·  net ${rec.net >= 0 ? '+' : ''}${rec.net}`, { fontFamily: FONT, fontSize: '16px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    // The chip history lives in the local database when the service is up: take its balance as the stack
    // for the next fight and show the record it keeps, so the same chips follow you across reloads.
    void fetchChipSummary().then((s) => {
      if (!s || !this.scene.isActive()) return
      saveChips(startingChips(s, loadChips()))
      saveRecord({ fights: s.fights, won: s.betsWon, lost: s.betsLost, net: s.net, best: s.best })
      line.setText(`chips ${s.balance}  ·  fights ${s.fights}  ·  bets won ${s.betsWon} lost ${s.betsLost}  ·  net ${s.net >= 0 ? '+' : ''}${s.net}  ·  best ${s.best}  ·  today ${s.todayNet >= 0 ? '+' : ''}${s.todayNet}${s.bailouts ? `  ·  bailouts ${s.bailouts}` : ''}`)
      const recent = s.recentBets.slice(0, 4).map((b) => `${b.result === 'won' ? '+' + b.paid : b.result === 'lost' ? '-' + b.stake : '±0'} on ${b.corner === 'a' ? 'blue' : 'red'} ${b.market}`).join('  ·  ')
      if (recent) add(this.add.text(W / 2, 496, `recent: ${recent}`, { fontFamily: FONT, fontSize: '13px', color: HEX(0x5a4632), fontStyle: '900' }).setOrigin(0.5))
    })
    add(this.add.text(W / 2, 500, this.health, { fontFamily: FONT, fontSize: '15px', color: HEX(P.ink), fontStyle: '900' }).setOrigin(0.5))
    const go = add(new ComicButton(this, W / 2, H - 100, 'RING THE BELL', () => this.start(), { color: this.row === 2 ? P.red : P.green, w: 380, h: 66, size: 30 }))
    if (this.row === 2) go.setScale(1.06)
    add(this.add.text(W / 2, H - 46, '↑↓ rows · ←→ change fighter · Enter start · Esc back', { fontFamily: FONT, fontSize: '14px', color: HEX(P.ink), fontStyle: '900', backgroundColor: HEX(P.paper), padding: { x: 10, y: 4 } }).setOrigin(0.5))
    void MenuNav; void Book
  }
  update(_t: number, dt: number): void { this.city.update(dt) }
}

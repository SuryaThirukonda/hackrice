// Dev-only listening page (announcer-review.html): every take and line with its priority, text, segment length, a
// play button through the game's own voice player, and the command that regenerates a bad take.
import { sfx } from '../fx/sfx'
import { CUES, TAKES, cueOf, type Group } from './lines'
import type { Manifest } from './manifest'
import { voice, type PlayHandle } from './voice'

const GROUPS: Group[] = ['shared', 'card', 'boxing', 'bowling', 'golf']
const statusEl = document.getElementById('status')!
const listEl = document.getElementById('list')!
let playing: PlayHandle | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text) e.textContent = text
  if (cls) e.className = cls
  return e
}

function play(ids: string[], i = 0): void {
  if (i === 0) { playing?.stop(40); playing = null }
  const id = ids[i]
  if (!id) return
  if (voice.status(id) !== 'ready') { statusEl.textContent = `${id} is not ready (${voice.status(id)}). Press Start audio, or generate the take.`; return }
  playing = voice.play(id, () => { playing = null; setTimeout(() => play(ids, i + 1), 250) })
}

async function main(): Promise<void> {
  const manifest = await fetch('/announcer/manifest.json', { cache: 'no-cache' }).then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null)).catch(() => null)
  statusEl.textContent = manifest
    ? `voice ${manifest.voiceId} · ${manifest.modelId} · ${manifest.outputFormat} · generated ${manifest.generatedAt} · ${Object.keys(manifest.takes).length} of ${TAKES.length} takes`
    : 'No manifest yet: run npm run announcer -- generate. Lines below show their text only.'
  document.getElementById('unlock')!.addEventListener('click', () => { sfx.unlock(); voice.load(GROUPS); statusEl.textContent += ' · audio on' })

  for (const take of TAKES) {
    const entry = manifest?.takes[take.id]
    const section = el('section')
    const head = el('h2', `${take.id} `)
    const playTake = el('button', 'Play take')
    playTake.addEventListener('click', () => play(take.lines.map(([id]) => id)))
    head.append(playTake)
    const chars = take.lines.reduce((n, [, text]) => n + text.length, 0)
    const retake = entry ? `npm run announcer -- generate --only ${take.id} --seed ${entry.seed + 1}` : `npm run announcer -- generate --only ${take.id}`
    const meta = el('p', '', 'muted')
    meta.append(`${take.group} · ${take.lines.length} lines · about ${chars} characters · ${entry ? `${(entry.bytes / 1024).toFixed(0)} KB, seed ${entry.seed}` : 'not generated'} · retake: `, el('code', retake))
    const table = el('table')
    for (const [id, text] of take.lines) {
      const row = el('tr')
      const btn = el('button', 'Play')
      btn.addEventListener('click', () => play([id]))
      const seg = manifest?.lines[id]
      const length = seg && seg.start !== null && seg.end !== null ? `${(seg.end - seg.start).toFixed(2)} s` : seg ? 'whole file' : 'missing'
      const cells = [el('td'), el('td', id), el('td', `P${CUES[cueOf(id)]?.priority ?? '?'}`), el('td', text), el('td', length, seg ? 'n' : 'n bad')]
      cells[0].append(btn)
      row.append(...cells)
      table.append(row)
    }
    section.append(head, meta, table)
    listEl.append(section)
  }
}

void main()

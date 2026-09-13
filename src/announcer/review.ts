import { sfx } from '../fx/sfx'
import { TAKES } from './lines'
import { voice } from './voice'

const statusEl = document.getElementById('status') as HTMLParagraphElement
const unlockBtn = document.getElementById('unlock') as HTMLButtonElement
const listEl = document.getElementById('list') as HTMLDivElement

let audioUnlocked = false

async function init(): Promise<void> {
  // Start loading all audio groups
  voice.load(['shared', 'boxing', 'card', 'bowling', 'golf'])

  unlockBtn.addEventListener('click', () => {
    sfx.unlock()
    audioUnlocked = true
    unlockBtn.textContent = 'Audio Started ✓'
    unlockBtn.disabled = true
    render()
  })

  // Periodically check manifest status until loaded
  const checkInterval = setInterval(() => {
    // Check if ready
    const sampleStatus = voice.status('menu.welcome#1')
    if (sampleStatus !== 'loading') {
      clearInterval(checkInterval)
      if (sampleStatus === 'ready') {
        statusEl.textContent = 'Manifest loaded. Audio clips ready for playback.'
        statusEl.className = ''
      } else {
        statusEl.textContent = 'Manifest loaded (some or all clips may be missing).'
      }
      render()
    }
  }, 300)

  render()
}

function render(): void {
  listEl.innerHTML = ''

  for (const take of TAKES) {
    const sec = document.createElement('section')
    const h2 = document.createElement('h2')
    h2.textContent = `${take.id} [${take.group}]`
    sec.appendChild(h2)

    const table = document.createElement('table')
    for (const [lineId, text] of take.lines) {
      const tr = document.createElement('tr')

      const tdId = document.createElement('td')
      const code = document.createElement('code')
      code.textContent = lineId
      tdId.appendChild(code)
      tr.appendChild(tdId)

      const tdText = document.createElement('td')
      tdText.textContent = text
      tr.appendChild(tdText)

      const tdDur = document.createElement('td')
      tdDur.className = 'n muted'
      const dur = voice.duration(lineId)
      tdDur.textContent = dur !== null ? `${dur.toFixed(2)}s` : '-'
      tr.appendChild(tdDur)

      const tdStatus = document.createElement('td')
      const st = voice.status(lineId)
      tdStatus.textContent = st
      tdStatus.className = st === 'ready' ? 'muted' : st === 'missing' ? 'bad' : 'muted'
      tr.appendChild(tdStatus)

      const tdAction = document.createElement('td')
      const btn = document.createElement('button')
      btn.textContent = 'Play'
      btn.addEventListener('click', () => {
        if (!audioUnlocked) {
          sfx.unlock()
          audioUnlocked = true
          unlockBtn.textContent = 'Audio Started ✓'
          unlockBtn.disabled = true
        }
        btn.textContent = 'Playing...'
        btn.disabled = true
        const handle = voice.play(lineId, () => {
          btn.textContent = 'Play'
          btn.disabled = false
        })
        if (!handle) {
          btn.textContent = 'Failed'
          setTimeout(() => {
            btn.textContent = 'Play'
            btn.disabled = false
          }, 1000)
        }
      })
      tdAction.appendChild(btn)
      tr.appendChild(tdAction)

      table.appendChild(tr)
    }
    sec.appendChild(table)
    listEl.appendChild(sec)
  }
}

void init()

/**
 * Comic-styled DOM overlay for typing body weight (Phaser text entry is awkward).
 */
import { formatWeightLabel, kgToDisplay, parseWeightInput } from '../health/weightInput'
import type { GameSettings } from '../agent/sliders'

export function openWeightEditor(
  host: HTMLElement,
  settings: GameSettings,
  onSave: (next: GameSettings) => void,
  onCancel: () => void,
): () => void {
  const root = document.createElement('div')
  root.setAttribute('data-tempo-weight', '1')
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000', 'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(20,18,26,.55)', 'font-family:"Bangers",system-ui,sans-serif',
  ].join(';')

  const card = document.createElement('div')
  card.style.cssText = [
    'background:#f4e6c8', 'border:5px solid #14121a', 'border-radius:18px', 'box-shadow:10px 10px 0 #14121a',
    'padding:28px 32px', 'min-width:320px', 'max-width:92vw', 'color:#14121a',
  ].join(';')

  const title = document.createElement('div')
  title.textContent = 'BODY WEIGHT'
  title.style.cssText = 'font-size:28px;letter-spacing:1px;margin-bottom:8px'
  const hint = document.createElement('div')
  hint.textContent = 'Type a number · Esc cancel'
  hint.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;font-weight:900;opacity:.7;margin-bottom:16px'

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:10px;align-items:center'

  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'decimal'
  input.autocomplete = 'off'
  input.placeholder = '75.0'
  input.value = settings.weightKg === null ? '' : String(Math.round(kgToDisplay(settings.weightKg, settings.weightUnit) * 10) / 10)
  input.style.cssText = [
    'flex:1', 'font-size:28px', 'font-weight:900', 'font-family:ui-monospace,monospace',
    'padding:10px 14px', 'border:4px solid #14121a', 'border-radius:12px', 'background:#fff8e8', 'outline:none',
  ].join(';')

  const unitBtn = document.createElement('button')
  let unit = settings.weightUnit
  const paintUnit = () => { unitBtn.textContent = unit.toUpperCase() }
  paintUnit()
  unitBtn.type = 'button'
  unitBtn.style.cssText = [
    'font-family:inherit', 'font-size:20px', 'padding:10px 16px', 'border:4px solid #14121a', 'border-radius:12px',
    'background:#f0c43a', 'cursor:pointer', 'box-shadow:4px 4px 0 #14121a',
  ].join(';')
  unitBtn.onclick = () => {
    const parsed = parseWeightInput(input.value, unit)
    const kg = parsed.ok ? parsed.kg : settings.weightKg
    unit = unit === 'kg' ? 'lb' : 'kg'
    if (kg !== null) {
      const v = kgToDisplay(kg, unit)
      input.value = unit === 'kg' ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))
    }
    paintUnit()
  }

  const err = document.createElement('div')
  err.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;font-weight:900;color:#c0392b;min-height:18px;margin-top:10px'

  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:10px;margin-top:18px;justify-content:flex-end'

  const mkBtn = (label: string, bg: string, fn: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = `font-family:inherit;font-size:18px;padding:10px 18px;border:4px solid #14121a;border-radius:12px;background:${bg};cursor:pointer;box-shadow:4px 4px 0 #14121a`
    b.onclick = fn
    return b
  }

  const close = () => { root.remove(); onCancel() }
  const save = () => {
    const parsed = parseWeightInput(input.value, unit)
    if (!parsed.ok) { err.textContent = parsed.error; return }
    onSave({ ...settings, weightKg: parsed.kg, weightUnit: unit })
    root.remove()
  }

  actions.append(
    mkBtn('CLEAR', '#cfc3a7', () => { onSave({ ...settings, weightKg: null, weightUnit: unit }); root.remove() }),
    mkBtn('CANCEL', '#fff8e8', close),
    mkBtn('SAVE', '#3ecf8e', save),
  )

  row.append(input, unitBtn)
  card.append(title, hint, row, err, actions)
  root.append(card)
  host.appendChild(root)
  input.focus()
  input.select()

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    if (e.key === 'Enter') { e.preventDefault(); save() }
  }
  window.addEventListener('keydown', onKey, true)
  return () => { window.removeEventListener('keydown', onKey, true); root.remove() }
}

export { formatWeightLabel }

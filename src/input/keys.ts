/** Frame-based keyboard state with press edges, fed by DOM/Phaser key events. Pure and testable. */
export class KeyState {
  private down = new Set<string>()
  private edges = new Set<string>()
  onDown(code: string): void { if (!this.down.has(code)) { this.down.add(code); this.edges.add(code) } }
  onUp(code: string): void { this.down.delete(code) }
  /** Call once per frame after the command was built. */
  endFrame(): void { this.edges.clear() }
  isDown(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)) }
  justPressed(...codes: string[]): boolean { return codes.some((c) => this.edges.has(c)) }
  clear(): void { this.down.clear(); this.edges.clear() }
  attach(target: Window | HTMLElement = window): () => void {
    const d = (e: KeyboardEvent) => { this.onDown(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault() }
    const u = (e: KeyboardEvent) => this.onUp(e.code)
    const blur = () => this.clear()
    target.addEventListener('keydown', d as EventListener); target.addEventListener('keyup', u as EventListener); window.addEventListener('blur', blur)
    return () => { target.removeEventListener('keydown', d as EventListener); target.removeEventListener('keyup', u as EventListener); window.removeEventListener('blur', blur) }
  }
}

import { Container, Text, type Application } from 'pixi.js'
import type { Scene, Tick } from './Scene'

/** Used for sports whose scene is not built yet: shows the last tick as text. */
export class PlaceholderScene implements Scene {
  private root = new Container()
  private text = new Text({ text: '', style: { fontFamily: 'Nunito, sans-serif', fontSize: 26, fill: 0xeef2f6, fontWeight: '900', wordWrap: true, wordWrapWidth: 700 } })
  private label: string
  constructor(label: string) { this.label = label }
  mount(_app: Application, root: Container, size: { w: number; h: number }): void { root.addChild(this.root); this.root.addChild(this.text); this.text.anchor.set(0.5); this.resize(size); this.text.text = this.label }
  resize(size: { w: number; h: number }): void { this.text.position.set(size.w / 2, size.h / 2); this.text.style.wordWrapWidth = size.w * 0.8 }
  update(): void {}
  onTick(tick: Tick): void { this.text.text = `${this.label}\n${JSON.stringify(tick).slice(0, 220)}` }
  onPhase(): void {}
  onMatch(): void {}
  unmount(): void { this.root.destroy({ children: true }) }
}

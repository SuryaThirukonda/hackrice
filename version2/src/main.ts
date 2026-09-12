import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { TitleScene } from './scenes/TitleScene'
import { MainMenuScene } from './scenes/MainMenuScene'
import { ModeSelectScene } from './scenes/ModeSelectScene'
import { GameSelectScene } from './scenes/GameSelectScene'
import { PlaceholderScene } from './scenes/PlaceholderScene'
import { CursorTrail } from './fx/CursorTrail'
import { isWiping } from './fx/transitions'
import { BoxingScene } from './games/boxing/BoxingScene'
import { TutorialScene } from './scenes/TutorialScene'
import { PreFightScene } from './scenes/PreFightScene'
import { SettingsScene } from './scenes/SettingsScene'
import { FightNightScene } from './scenes/FightNightScene'
import { BowlingScene } from './games/bowling/BowlingScene'
import { GolfScene } from './games/golf/GolfScene'

if (import.meta.env.DEV) {
  window.addEventListener('error', (e) => { const w = window as unknown as { __errs?: string[] }; (w.__errs ??= []).push(String(e.error?.stack ?? e.message)) })
  // Dev-only: drive tweens from the game loop delta instead of Date.now(), so a synthetic clock (see __advance) moves them too.
  ;(Phaser.Tweens.TweenManager.prototype as unknown as { getDelta: () => number }).getDelta = function (this: { scene: Phaser.Scene }) { return this.scene.game.loop.delta }
}

function start(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1f8ff0',
    transparent: true, // 3D games render on a canvas behind Phaser
    antialias: true,
    // The in-app preview pane may not fire requestAnimationFrame while hidden; a setTimeout ticker keeps the game alive in dev.
    fps: { forceSetTimeOut: import.meta.env.DEV, target: 60 },
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
    scene: [BootScene, TitleScene, MainMenuScene, ModeSelectScene, GameSelectScene, PlaceholderScene, BoxingScene, TutorialScene, PreFightScene, SettingsScene, FightNightScene, BowlingScene, GolfScene, CursorTrail],
  })

  // Re-lay out the active screen when the window size changes (menus position everything from scale.width/height).
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  game.scale.on(Phaser.Scale.Events.RESIZE, () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const active = game.scene.getScenes(true).find((s) => s.scene.key !== 'cursor' && s.scene.key !== 'boot') as (Phaser.Scene & { onResize?: () => void }) | undefined
      if (!active || isWiping()) return
      if (typeof active.onResize === 'function') active.onResize()
      else active.scene.restart(active.scene.settings.data)
    }, 250)
  })

  if (import.meta.env.DEV) {
    // Dev-only hooks: step the game clock synchronously (screenshot-driven checks in a throttled tab).
    const w = window as unknown as { __game?: Phaser.Game; __advance?: (ms: number) => void }
    w.__game = game
    w.__advance = (ms: number) => { const step = 1000 / 60; for (let t = 0; t < ms; t += step) game.loop.step(game.loop.now + step) }
  }
}

// Wait for a settled, non-trivial window size before booting so the canvas is created at its final size.
let lastW = -1
const whenSized = (): void => {
  const w = window.innerWidth, h = window.innerHeight
  if (w >= 320 && h >= 240 && w === lastW) start()
  else { lastW = w; setTimeout(whenSized, 60) }
}
whenSized()

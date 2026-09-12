import { useEffect, useRef } from 'react'
import { Application, Container } from 'pixi.js'
import { useArena } from '../../lib/store'
import type { Effects, Scene } from './Scene'
import { BowlingScene } from './BowlingScene'
import { PlaceholderScene } from './PlaceholderScene'
import { BoxingScene } from './BoxingScene'

function sceneFor(sport: string | null, fx: Effects): Scene {
  if (sport === 'bowling') return new BowlingScene(fx)
  if (sport === 'boxing') return new BoxingScene(fx)
  if (sport === 'baseball') { return new PlaceholderScene('Ballpark (scene arrives in M8)') }
  return new PlaceholderScene('')
}

/** One Pixi Application for the projector. Scenes swap on match.start; effects (shake, hit-stop, slow-mo) live here. */
export function PixiStage() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let app: Application | null = null
    let scene: Scene | null = null
    let sport: string | null = null
    const root = new Container()
    const world = new Container()
    root.addChild(world)
    const fxState = { shake: 0, hitstopUntil: 0, slow: 1, slowUntil: 0 }
    const fx: Effects = {
      shake: (s) => { fxState.shake = Math.max(fxState.shake, s) },
      hitstop: (ms) => { fxState.hitstopUntil = performance.now() + ms },
      slowmo: (f, ms) => { fxState.slow = f; fxState.slowUntil = performance.now() + ms },
    }
    const size = () => ({ w: el.clientWidth || 800, h: el.clientHeight || 600 })
    const swap = (sp: string | null) => {
      if (!app) return
      scene?.unmount(); world.removeChildren()
      sport = sp; scene = sceneFor(sp, fx); scene.mount(app, world, size())
      const st = useArena.getState()
      scene.onMatch(st.match as unknown as Record<string, unknown>); if (st.phase) scene.onPhase(st.phase)
    }
    ;(async () => {
      const a = new Application()
      await a.init({ resizeTo: el, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true })
      if (cancelled) { a.destroy(true); return }
      app = a
      el.appendChild(a.canvas)
      a.stage.addChild(root)
      swap(useArena.getState().match?.sport ?? null)
      a.ticker.add((t) => {
        const now = performance.now()
        if (now < fxState.hitstopUntil) return
        const slow = now < fxState.slowUntil ? fxState.slow : 1
        scene?.update(t.deltaMS * slow)
        if (fxState.shake > 0.2) { world.position.set((Math.random() - 0.5) * fxState.shake, (Math.random() - 0.5) * fxState.shake); fxState.shake *= 0.85 } else { world.position.set(0, 0); fxState.shake = 0 }
      })
    })()
    const unsub = useArena.subscribe((s, prev) => {
      if (!app) return
      const sp = s.match?.sport ?? null
      if (s.match?.match_id !== prev.match?.match_id || sp !== sport) swap(sp)
      else if (s.match !== prev.match) scene?.onMatch(s.match as unknown as Record<string, unknown>)
      if (s.tick && s.tick !== prev.tick) {
        scene?.onTick(s.tick)
        const flags = (s.tick.flags ?? {}) as { slowmo?: boolean }
        if (flags.slowmo) fx.slowmo(0.3, 1500)
      }
      if (s.phase !== prev.phase) scene?.onPhase(s.phase)
    })
    const ro = new ResizeObserver(() => scene?.resize(size()))
    ro.observe(el)
    return () => { cancelled = true; unsub(); ro.disconnect(); scene?.unmount(); if (app) { app.destroy(true, { children: true }); app = null } }
  }, [])
  return <div ref={host} className="pixi-host" />
}

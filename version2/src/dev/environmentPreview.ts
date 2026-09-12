import { Engine3D } from '../engine3d/Engine3D'
import { BoxingWorld } from '../games/boxing/render/BoxingWorld'
import { BowlingWorld } from '../games/bowling/render/BowlingWorld'
import { GolfWorld } from '../games/golf/render/GolfWorld'
import { HOLES } from '../games/golf/sim/holes'

// Separate Vite development entry. Never imported by the game or its production build.
if (import.meta.env.DEV) {
  const engine = await Engine3D.get()
  const sport = new URLSearchParams(location.search).get('sport') ?? 'boxing'
  const world = sport === 'golf' ? new GolfWorld(engine) : sport === 'bowling' ? new BowlingWorld(engine) : new BoxingWorld(engine, undefined, true)
  world.show(innerWidth, innerHeight)
  if (world instanceof GolfWorld) {
    world.course.setHole(HOLES[2])
    engine.camera.setPosition(-48, 42, 105); engine.camera.lookAt(0, 0, 230)
  } else if (world instanceof BowlingWorld) {
    engine.camera.setPosition(0.35, 2.3, 6.2); engine.camera.lookAt(0, 0.28, -16.6)
  } else {
    engine.camera.setPosition(8.5, 4.4, 10); engine.camera.lookAt(0, 1, 0)
  }
  let last = performance.now()
  const render = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now
    if (world instanceof GolfWorld) world.course.update(now / 1000, dt)
    engine.renderFrame(); requestAnimationFrame(render)
  }
  render()
  addEventListener('resize', () => world.resize(innerWidth, innerHeight))
}

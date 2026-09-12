import { HZ } from '../games/boxing/sim/constants'
import { cmd, type Command } from '../games/boxing/sim/types'
import { INTERVAL_MS, type BoxScript } from '../../server/tools'

const INTERVAL_TICKS = Math.round((INTERVAL_MS / 1000) * HZ)

/** Plays an agent's boxing script on the sim clock: one-shots at their tick, held actions persist until changed or the script expires. */
export class ScriptExecutor {
  private steps: { tick: number; do: string }[] = []
  private startTick = -1
  private block = false
  private forward: -1 | 0 | 1 = 0
  private strafe: -1 | 0 | 1 = 0
  scriptsPlayed = 0
  load(script: BoxScript, nowTick: number): void {
    this.startTick = nowTick
    this.steps = script.steps.map((s) => ({ tick: nowTick + Math.round((s.at_ms / 1000) * HZ), do: s.do }))
    this.scriptsPlayed++
  }
  /** True when no live script covers this tick (the model is late). */
  isLate(nowTick: number): boolean { return this.startTick < 0 || nowTick > this.startTick + INTERVAL_TICKS }
  command(nowTick: number): Command {
    if (this.isLate(nowTick)) { this.forward = 0; this.strafe = 0; return cmd({ block: true }) } // defensive idle while waiting
    let punch: Command['punch'] = null, dodge: Command['dodge'] = null
    while (this.steps.length && this.steps[0].tick <= nowTick) {
      const s = this.steps.shift()!.do
      switch (s) {
        case 'jab': case 'cross': punch = s; break
        case 'swayL': case 'swayR': case 'duck': dodge = s; break
        case 'block_on': this.block = true; break
        case 'block_off': this.block = false; break
        case 'in': this.forward = 1; break
        case 'out': this.forward = -1; break
        case 'left': this.strafe = -1; break
        case 'right': this.strafe = 1; break
        case 'idle': this.forward = 0; this.strafe = 0; this.block = false; break
        default: break
      }
    }
    return cmd({ punch, dodge, block: this.block && !punch, forward: this.forward, strafe: this.strafe })
  }
}

/** Reserved HUD regions so wellness overlays never sit on score, meters, or controls. */

export type HudRegion =
  | 'TOP_LEFT' | 'TOP_CENTER' | 'TOP_RIGHT'
  | 'MID_LEFT' | 'MID_RIGHT'
  | 'BOTTOM_LEFT' | 'BOTTOM_CENTER' | 'BOTTOM_RIGHT'

export interface Rect { x: number; y: number; w: number; h: number }

/** Sport-declared occupied regions at the current canvas size. */
export type SportHudMap = Partial<Record<HudRegion, Rect>>

export function boxingOccupied(W: number, H: number): SportHudMap {
  const bw = Math.min(420, W * 0.36)
  return {
    TOP_LEFT: { x: 20, y: 8, w: bw + 40, h: 140 },
    TOP_CENTER: { x: W / 2 - 90, y: 8, w: 180, h: 90 },
    TOP_RIGHT: { x: W - bw - 60, y: 8, w: bw + 40, h: 140 },
    BOTTOM_CENTER: { x: W * 0.1, y: H - 50, w: W * 0.8, h: 44 },
  }
}

export function bowlingOccupied(W: number, H: number): SportHudMap {
  return {
    TOP_CENTER: { x: W / 2 - 260, y: 8, w: 520, h: 100 },
    TOP_RIGHT: { x: W - 90, y: H * 0.15, w: 80, h: H * 0.65 },
    BOTTOM_LEFT: { x: 20, y: H - 220, w: 280, h: 160 },
    BOTTOM_CENTER: { x: W * 0.15, y: H - 50, w: W * 0.7, h: 44 },
  }
}

export function golfOccupied(W: number, H: number): SportHudMap {
  return {
    TOP_LEFT: { x: 20, y: 8, w: 360, h: 170 },
    TOP_RIGHT: { x: W - 250, y: 60, w: 230, h: 220 },
    BOTTOM_LEFT: { x: 20, y: H - 150, w: 280, h: 100 },
    BOTTOM_CENTER: { x: W / 2 - 220, y: H - 120, w: 440, h: 100 },
    BOTTOM_RIGHT: { x: W - 210, y: H - 240, w: 190, h: 190 },
  }
}

const ORDER: HudRegion[] = ['MID_LEFT', 'MID_RIGHT', 'TOP_LEFT', 'BOTTOM_LEFT', 'TOP_RIGHT', 'BOTTOM_RIGHT']

function overlaps(a: Rect, b: Rect, pad = 8): boolean {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y)
}

/** Place a chip of size (w,h) in the first free preferred region. */
export function placeOverlay(W: number, H: number, occupied: SportHudMap, w: number, h: number): Rect {
  const candidates: Record<HudRegion, Rect> = {
    TOP_LEFT: { x: 24, y: 150, w, h },
    TOP_CENTER: { x: W / 2 - w / 2, y: 100, w, h },
    TOP_RIGHT: { x: W - w - 24, y: 150, w, h },
    MID_LEFT: { x: 24, y: Math.max(160, H * 0.28), w, h },
    MID_RIGHT: { x: W - w - 24, y: Math.max(160, H * 0.28), w, h },
    BOTTOM_LEFT: { x: 24, y: H - h - 70, w, h },
    BOTTOM_CENTER: { x: W / 2 - w / 2, y: H - h - 70, w, h },
    BOTTOM_RIGHT: { x: W - w - 24, y: H - h - 70, w, h },
  }
  const blocks = Object.values(occupied)
  for (const key of ORDER) {
    const r = candidates[key]
    if (!blocks.some((b) => overlaps(r, b))) return r
  }
  return candidates.MID_LEFT
}

export function layoutDebugEnabled(): boolean {
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).get('layoutDebug') === '1'
}

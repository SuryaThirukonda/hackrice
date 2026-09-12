import { CameraFrame, PIXELFORMAT_RGBA16F, SSAOTYPE_NONE, TONEMAP_ACES, type AppBase, type CameraComponent } from 'playcanvas'
import { col } from './materials'

export type Quality = 'low' | 'medium' | 'high'

/** Optional post pass (vignette and grading only; no bloom, SSAO or DOF) used on the high setting. Alpha is preserved so the Phaser UI shows through. */
export class Post {
  frame: CameraFrame
  quality: Quality = 'high'
  private baseSat = 1.08
  constructor(app: AppBase, camera: CameraComponent) {
    this.frame = new CameraFrame(app, camera)
    const f = this.frame
    f.rendering.renderFormats = [PIXELFORMAT_RGBA16F]
    f.rendering.toneMapping = TONEMAP_ACES
    f.rendering.sharpness = 0
    f.bloom.intensity = 0 // no glow: the look is texture and ink, not neon
    f.vignette.intensity = 0.5; f.vignette.inner = 0.45; f.vignette.outer = 1.3; f.vignette.curvature = 0.6; f.vignette.color = col(0x0a0612)
    f.grading.enabled = true; f.grading.saturation = this.baseSat; f.grading.contrast = 1.04; f.grading.brightness = 1.0; f.grading.tint = col(0xffffff)
    f.dof.enabled = false
    f.ssao.type = SSAOTYPE_NONE
    f.taa.enabled = false
    f.update()
  }
  setQuality(q: Quality): void {
    this.quality = q
    const f = this.frame
    f.enabled = q === 'high' // medium and low render straight to the canvas (no extra full-screen passes)
    f.rendering.renderTargetScale = 1
    f.update()
  }
  /** Per-world colour tint and saturation. */
  grade(tint: number, saturation = this.baseSat): void { this.frame.grading.tint = col(tint); this.frame.grading.saturation = saturation; this.frame.update() }
  /** Depth of field was removed for performance; kept as a no-op for callers. */
  focus(distance: number | null): void { void distance }
}

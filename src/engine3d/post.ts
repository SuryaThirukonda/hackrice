import { CameraFrame, PIXELFORMAT_RGBA16F, SSAOTYPE_LIGHTING, SSAOTYPE_NONE, TONEMAP_ACES, type AppBase, type CameraComponent } from 'playcanvas'
import { col } from './materials'

export type Quality = 'low' | 'medium' | 'high'

/** Post-processing stack (bloom, vignette, grading, SSAO, DOF) on top of the camera. Alpha is preserved so the Phaser UI shows through. */
export class Post {
  frame: CameraFrame
  quality: Quality = 'high'
  private baseSat = 1.08
  constructor(app: AppBase, camera: CameraComponent) {
    this.frame = new CameraFrame(app, camera)
    const f = this.frame
    f.rendering.renderFormats = [PIXELFORMAT_RGBA16F]
    f.rendering.toneMapping = TONEMAP_ACES
    f.rendering.sharpness = 0.25
    f.bloom.intensity = 0 // no glow: the look is texture and ink, not neon
    f.vignette.intensity = 0.12; f.vignette.inner = 0.45; f.vignette.outer = 1.3; f.vignette.curvature = 0.6; f.vignette.color = col(0x0a0612)
    f.grading.enabled = true; f.grading.saturation = this.baseSat; f.grading.contrast = 1.04; f.grading.brightness = 1.0; f.grading.tint = col(0xffffff)
    f.dof.enabled = false; f.dof.nearBlur = false; f.dof.blurRadius = 3; f.dof.focusRange = 2.5
    f.taa.enabled = false
    f.update()
  }
  setQuality(q: Quality): void {
    this.quality = q
    const f = this.frame
    f.enabled = q !== 'low'
    // SSAO only on high: it is the single most expensive pass on integrated GPUs
    f.ssao.type = q === 'high' ? SSAOTYPE_LIGHTING : SSAOTYPE_NONE
    f.ssao.intensity = 0.45; f.ssao.radius = 10; f.ssao.samples = 8; f.ssao.blurEnabled = true
    f.rendering.renderTargetScale = 1 // full resolution; quality controls effects instead of blurring the scene
    f.update()
  }
  /** Per-world colour tint and saturation. */
  grade(tint: number, saturation = this.baseSat): void { this.frame.grading.tint = col(tint); this.frame.grading.saturation = saturation; this.frame.update() }
  /** Drama focus: DOF on the subject at `distance` metres, or off. */
  focus(distance: number | null): void {
    const f = this.frame
    f.dof.enabled = distance !== null && this.quality === 'high'
    if (distance !== null) f.dof.focusDistance = distance
    f.update()
  }
}

/**
 * The camera the player can see. The page owns the MediaStream, so there is exactly one OS permission
 * prompt and the preview is the same sensor the reading comes from; `framePump` sends those frames on.
 */
export type BrowserCameraState = 'off' | 'requesting' | 'ready' | 'error'

const MESSAGES: Readonly<Record<string, string>> = {
  NotAllowedError: 'Camera access was declined. Allow it for this page in the browser, then try again.',
  NotFoundError: 'No camera on this machine. Plug in a webcam, or start without the camera.',
  NotReadableError: 'The camera is in use by another app. Close it and try again.',
  OverconstrainedError: 'This camera cannot provide a usable video size.',
}

export class BrowserCamera {
  state: BrowserCameraState = 'off'
  error: string | null = null
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private parent: HTMLElement | null = null

  async start(): Promise<BrowserCameraState> {
    if (this.state === 'ready') return this.state
    this.state = 'requesting'
    this.error = null
    const media = navigator.mediaDevices as MediaDevices | undefined
    if (!media?.getUserMedia) {
      this.state = 'error'
      this.error = 'This browser cannot open a camera.'
      return this.state
    }
    try {
      this.stream = await media.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      })
    } catch (e) {
      const err = e as { name?: string; message?: string }
      this.state = 'error'
      this.error = MESSAGES[err.name ?? ''] ?? `Could not open the camera (${err.name || err.message || 'unknown error'}).`
      return this.state
    }
    const video = document.createElement('video')
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.srcObject = this.stream
    // Comic frame above the Phaser canvas (z-index 1), mirrored so moving left moves the preview left.
    // Frames are pumped from the raw video element (CSS transform does not affect drawImage).
    video.style.cssText = 'position:absolute;z-index:5;object-fit:cover;transform:scaleX(-1);border:4px solid #14121a;border-radius:16px;box-shadow:8px 8px 0 #14121a;background:#000;pointer-events:none'
    this.video = video
    // A muted local stream autoplays everywhere, but a blocked play() must not fail the whole start.
    try { await video.play() } catch { /* frames still arrive once it is in the document */ }
    this.state = 'ready'
    return this.state
  }

  mountPreview(container: HTMLElement, rect?: DOMRect): void {
    if (!this.video) return
    this.parent = container
    this.setRect(rect)
    container.appendChild(this.video)
  }

  /** Called again on resize: the game canvas moves, the preview follows it. */
  setRect(rect?: DOMRect): void {
    const v = this.video
    if (!v) return
    v.style.left = `${rect ? rect.x : 0}px`
    v.style.top = `${rect ? rect.y : 0}px`
    v.style.width = rect ? `${rect.width}px` : '100%'
    v.style.height = rect ? `${rect.height}px` : '100%'
  }

  unmountPreview(): void {
    this.video?.remove()
    this.parent = null
  }

  /** Hide the preview without releasing the MediaStream (in-game sensing continues). */
  hidePreview(): void {
    this.unmountPreview()
  }

  stop(): void {
    this.unmountPreview()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    if (this.video) this.video.srcObject = null
    this.video = null
    this.stream = null
    this.state = 'off'
    this.error = null
  }

  getVideo(): HTMLVideoElement | null { return this.video }
  get mounted(): boolean { return this.parent !== null }
}

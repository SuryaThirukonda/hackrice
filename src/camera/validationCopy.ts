/**
 * Presage validation codes are engineering vocabulary. The consumer path shows one short instruction
 * instead, and never a code, a confidence float or a metric name.
 */

/** The camera states the Ready-Up flow can actually be in, for copy and badge colour. */
export type CameraUxState = 'off' | 'requesting' | 'denied' | 'noCamera' | 'starting' | 'framing' | 'measuring' | 'ready' | 'error'

const COPY: Readonly<Record<string, string>> = {
  Ok: 'Looking good',
  NoFaceFound: 'Move into frame',
  FaceTooFar: 'Move closer',
  FaceSizeOutOfRange: 'Move closer',
  FaceTooClose: 'Step back slightly',
  FaceNotCentered: 'Center yourself',
  FaceTooHigh: 'Center yourself',
  FaceTooLow: 'Center yourself',
  TooDark: 'Add more light',
  TooBright: 'Reduce glare',
  ExcessiveMotion: 'Hold still',
  ChestNotVisible: 'Step back slightly (show chest)',
  MultipleFacesFound: 'Only one person in frame',
  FaceNotForward: 'Face the camera',
  FrameRateTooLow: 'Hold still — waiting for a steadier camera feed',
}

/** The SDK's own hint is usually a sentence a person can follow; a bare code name is not. */
function human(guidance: string): boolean {
  const s = guidance.trim()
  return s.length >= 3 && s.length <= 90 && /\s/.test(s) && /[a-z]/.test(s) && !/^code \d+/i.test(s) && !/^k[A-Z]/.test(s)
}

export function consumerValidation(validation: string, guidance: string): string {
  const known = COPY[String(validation).replace(/^k/, '')]
  if (known) return known
  return human(guidance) ? guidance.trim() : 'Adjust position'
}

/** Map SDK / bridge error strings into short consumer copy. Never show raw codes as the primary line. */
export function consumerCameraError(error: string | null | undefined, guidance: string | null | undefined): string {
  const raw = `${error ?? ''} ${guidance ?? ''}`
  if (/processing failed|\(8/i.test(raw)) {
    return 'Camera sensing failed. Check lighting and framing, then tap Retry — or play with phone movement only.'
  }
  if (/credit|exhausted/i.test(raw)) return 'Camera wellness unavailable (account credits). You can still play with phone movement.'
  if (/auth|api key|PRESSAGE|PRESAGE/i.test(raw)) return 'Camera wellness unavailable (API key). You can still play with phone movement.'
  if (guidance && human(guidance)) return guidance.trim()
  if (error && human(error)) return error.trim()
  return 'Camera wellness unavailable. You can still play with phone movement.'
}

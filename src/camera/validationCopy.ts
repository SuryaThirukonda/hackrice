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

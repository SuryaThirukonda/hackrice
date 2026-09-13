import { describe, expect, it } from 'vitest'
import { consumerValidation } from './validationCopy'

describe('consumer camera guidance', () => {
  it('turns every validation code the SDK reports into one short instruction', () => {
    expect(consumerValidation('Ok', 'Good measurement')).toBe('Looking good')
    expect(consumerValidation('NoFaceFound', '')).toBe('Move into frame')
    expect(consumerValidation('FaceTooFar', '')).toBe('Move closer')
    expect(consumerValidation('FaceSizeOutOfRange', '')).toBe('Move closer')
    expect(consumerValidation('FaceTooClose', '')).toBe('Step back slightly')
    expect(consumerValidation('FaceNotCentered', '')).toBe('Center yourself')
    expect(consumerValidation('FaceTooHigh', '')).toBe('Center yourself')
    expect(consumerValidation('FaceTooLow', '')).toBe('Center yourself')
    expect(consumerValidation('TooDark', '')).toBe('Add more light')
    expect(consumerValidation('TooBright', '')).toBe('Reduce glare')
    expect(consumerValidation('ExcessiveMotion', '')).toBe('Hold still')
    expect(consumerValidation('ChestNotVisible', '')).toBe('Step back slightly (show chest)')
    expect(consumerValidation('MultipleFacesFound', '')).toBe('Only one person in frame')
    expect(consumerValidation('FaceNotForward', '')).toBe('Face the camera')
  })
  it('accepts the raw enum spelling too', () => {
    expect(consumerValidation('kTooDark', '')).toBe('Add more light')
  })
  it('falls back to the SDK hint only when it reads like a sentence', () => {
    expect(consumerValidation('FrameRateTooLow', 'move a little closer to the camera')).toBe('move a little closer to the camera')
    expect(consumerValidation('CameraTuning', '')).toBe('Adjust position')
    expect(consumerValidation('code 42', 'code 42')).toBe('Adjust position')
    expect(consumerValidation('status 3', 'kFaceNotForward')).toBe('Adjust position')
    expect(consumerValidation('running', 'FrameRateTooLow')).toBe('Adjust position')
  })
})

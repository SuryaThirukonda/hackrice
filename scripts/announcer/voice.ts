/** The announcer voice and generation settings shared by every CLI command. */

export const KEY_ENV = 'ELEVENLABS_KEY'
export const VOICE_ENV = 'ELEVENLABS_ANNOUNCER_VOICE'

/** A stock ElevenLabs voice, used unless ELEVENLABS_ANNOUNCER_VOICE names another. The free plan can't design one through the API. */
export const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'

export const VOICE_NAME = 'Tempo Announcer'
export const VOICE_DESCRIPTION = 'A booming, charismatic arena announcer with a warm, slightly gravelly American voice. Big theatrical energy: '
  + 'stretches the big names, punches key words, and sounds thrilled by every strike, birdie and knockout, while staying '
  + 'clear and easy to understand. Studio-quality recording, close microphone, no music or crowd noise.'
/** Voice Design charges these characters once for all three previews; the endpoint needs 100 to 1000. */
export const PREVIEW_TEXT = "Ladies and gentlemen... welcome to TEMPO! In the blue corner... Knuckles McGRAW! STRIKE! Right in the pocket! That's a BIRDIE! And it's a KNOCKOUT!"

export const TTS_MODEL = 'eleven_v3'
export const DESIGN_MODEL = 'eleven_ttv_v3'
export const DESIGN_FALLBACK_MODEL = 'eleven_multilingual_ttv_v2'
export const OUTPUT_FORMAT = 'mp3_44100_96'
/** v3's Natural setting; 0 is Creative, 1 is Robust. */
export const DEFAULT_STABILITY = 0.5
export const DEFAULT_MAX_CHARS = 4500

export const OUT_DIR = 'public/announcer'
export const DESIGN_DIR = 'data/announcer/voice-design'

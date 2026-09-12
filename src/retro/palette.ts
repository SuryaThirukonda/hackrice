/** Shared 32-colour-ish arcade palette. Game stages use small subsets of this. */
export const RETRO = {
  ink: '#071126', navy: '#0b1e48', blueDark: '#123b82', blue: '#1677e8', cyan: '#54c9ff',
  sky: '#55a9ef', paper: '#fff2d2', white: '#fffaf0', grey: '#8b96ad', steel: '#46536e',
  redDark: '#9e1830', red: '#ed2d32', orange: '#f0792f', gold: '#ffd33d', brown: '#754126',
  skinDark: '#8c4e2d', skin: '#cf7945', skinLight: '#f2ad6f',
  greenDark: '#1d5c38', green: '#3f9446', lime: '#7bcf4b', mint: '#b0e36b',
  sand: '#edcf8b', water: '#2788dc', purple: '#683c96', magenta: '#db3e9d',
} as const

export type RetroTheme = 'meadow' | 'canyon' | 'neon'

export const COURSE_PALETTE: Record<RetroTheme, { sky: string; rough: string; fairway: string; green: string; sand: string; water: string; accent: string }> = {
  meadow: { sky: '#55a9ef', rough: '#28743f', fairway: '#55ae4b', green: '#8bd45a', sand: '#edcf8b', water: '#2788dc', accent: '#ed2d32' },
  canyon: { sky: '#ef8a4c', rough: '#a95d35', fairway: '#91ad47', green: '#b0d85c', sand: '#f0cc88', water: '#38a6c8', accent: '#8f253a' },
  neon: { sky: '#160d3e', rough: '#17204f', fairway: '#3154ba', green: '#58d6aa', sand: '#b7a5df', water: '#35dbe7', accent: '#db3e9d' },
}

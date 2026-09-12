import type { Theme } from './types'

export type CourseId = Theme
export interface CourseDef { id: CourseId; name: string; holes: number[]; wind: { min: number; max: number } }

/** Three-hole courses: indices into HOLES plus the wind speed range (m/s) drawn per hole. */
export const COURSES: CourseDef[] = [
  { id: 'meadow', name: 'Meadow Links', holes: [0, 1, 2], wind: { min: 0, max: 6 } },
  { id: 'canyon', name: 'Desert Canyon', holes: [3, 4, 5], wind: { min: 1, max: 7 } },
  { id: 'neon', name: 'Neon Night', holes: [6, 7, 8], wind: { min: 0, max: 4 } },
]

export const DEFAULT_COURSE: CourseId = 'meadow'
export function courseById(id: CourseId | undefined): CourseDef { return COURSES.find((c) => c.id === id) ?? COURSES[0] }

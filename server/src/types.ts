// Shared domain types. Keep in sync with app/src/types.ts.

export type Role = 'elder' | 'coordinator' | 'caregiver' | 'family'
export type Lang = 'ar' | 'fr' | 'en'

export interface Person {
  id: string
  name: string
  role: Role
  /** hired caregiver = false; drives the `family` visibility level */
  isFamily: boolean
  lang: Lang
  /** demo sign-in username (first name, lowercase) */
  username: string
  /** demo password — "123" for everyone. NEVER serialized to a client. */
  password: string
}

/** Person with the secret stripped — the only shape sent over the wire. */
export type PublicPerson = Omit<Person, 'password'>

export function toPublicPerson(p: Person): PublicPerson {
  const { password: _pw, ...rest } = p
  return rest
}

export type ActivityTag =
  | 'garden'
  | 'outing'
  | 'physio'
  | 'companionship'
  | 'personal-care'
  | 'errands'

export interface Shift {
  id: string
  caregiverId: string | null
  start: string
  end: string
  purpose: string
  activityTags: ActivityTag[]
  /** short guidance the coordinator leaves for the assigned caregiver */
  coordinatorNote?: string
}

export type Mood = 'good' | 'ok' | 'hard'
export type CheckinVisibility = 'circle' | 'family' | 'coordinator' | 'mood-only'
export type CheckinAccess = 'full' | 'mood' | 'none'

export interface Checkin {
  id: string
  date: string
  authorId: string
  mood: Mood
  transcript: string
  translation: string
  audioId: string
  spokenLang: Lang
  visibility: CheckinVisibility
  createdVia: 'live' | 'demo'
}

export interface PrayerTimes {
  fajr: string
  dhuhr: string
  asr: string
  maghrib: string
  isha: string
}

// --- care plan: a weekly routine + per-day completions + one-off tasks ---
export type TaskCategory =
  | 'medication'
  | 'personal-care'
  | 'meal'
  | 'rest'
  | 'activity'
  | 'other'

/** the standing plan — the coordinator sets this up per weekday */
export interface RoutineItem {
  id: string
  title: string
  time: string // "HH:MM"
  category: TaskCategory
  timeSensitive: boolean
  weekdays: number[] // 0=Sun .. 6=Sat
}

/** one row per (routine item, date) — created only when it's actually done */
export interface Completion {
  id: string
  routineItemId: string
  date: string // YYYY-MM-DD
  doneAt: string
  doneById: string
  doneByName: string
  note?: string
}

/** something extra a caregiver did on a specific day */
export interface AdHocTask {
  id: string
  date: string
  title: string
  time: string
  category: TaskCategory
  timeSensitive: boolean
  addedById: string
  addedByName: string
  doneAt: string | null
  doneById: string | null
  doneByName: string | null
  note?: string
}

/** the expanded shape returned by GET /api/tasks?date= */
export interface PlanRow {
  key: string // "r:<routineItemId>" | "a:<adHocId>"
  kind: 'routine' | 'adhoc'
  title: string
  scheduledTime: string
  category: TaskCategory
  timeSensitive: boolean
  doneAt: string | null
  doneById: string | null
  doneByName: string | null
  note: string | null
  weekdays?: number[]
  addedByName?: string
}

// --- clinical files -------------------------------------------------------
// The app STORES these. It never reads, OCRs, or interprets them.
export type FileCategory =
  | 'discharge'
  | 'prescription'
  | 'lab'
  | 'imaging'
  | 'care-plan'
  | 'other'
export type FileVisibility = 'circle' | 'family' | 'coordinator'

export interface ClinicalFile {
  id: string
  name: string
  category: FileCategory
  visibility: FileVisibility
  uploadedById: string
  uploadedByName: string
  uploadedAt: string
  mime: string
  size: number
  /** true for the seeded demo entries that have no real bytes on disk */
  seeded?: boolean
  /** passed the upload scan (structure + signature + heuristics) */
  scannedClean?: boolean
}

// In-memory state with plain JSON-file persistence. No native deps → Replit-safe.
// `people` (credentials) is ALWAYS from seed.ts; everything else persists so the
// coordinator's edits survive a restart.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type {
  AdHocTask,
  Checkin,
  ClinicalFile,
  Completion,
  Person,
  RoutineItem,
  Shift,
} from './types.js'
import {
  adHoc as seedAdHoc,
  checkins as seedCheckins,
  completions as seedCompletions,
  files as seedFiles,
  people,
  routine as seedRoutine,
  shifts as seedShifts,
} from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data.json')

export interface DBShape {
  people: Person[]
  shifts: Shift[]
  checkins: Checkin[]
  files: ClinicalFile[]
  routine: RoutineItem[]
  completions: Completion[]
  adHoc: AdHocTask[]
}

function seedState(): DBShape {
  return {
    people,
    shifts: structuredClone(seedShifts),
    checkins: structuredClone(seedCheckins),
    files: structuredClone(seedFiles),
    routine: structuredClone(seedRoutine),
    completions: structuredClone(seedCompletions),
    adHoc: structuredClone(seedAdHoc),
  }
}

function load(): DBShape {
  const base = seedState()
  if (existsSync(DB_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(DB_PATH, 'utf8')) as Partial<DBShape>
      if (Array.isArray(saved.shifts)) base.shifts = saved.shifts
      if (Array.isArray(saved.checkins)) base.checkins = saved.checkins
      if (Array.isArray(saved.files)) base.files = saved.files
      if (Array.isArray(saved.routine)) base.routine = saved.routine
      if (Array.isArray(saved.completions)) base.completions = saved.completions
      if (Array.isArray(saved.adHoc)) base.adHoc = saved.adHoc
    } catch {
      // fall through to seed
    }
  }
  return base
}

export const db: DBShape = load()

export function persist(): void {
  try {
    const { people: _p, ...rest } = db
    writeFileSync(DB_PATH, JSON.stringify(rest, null, 2))
  } catch {
    // demo — losing persistence is acceptable
  }
}

/** Reset to seed (handy for demo rehearsal). */
export function reset(): void {
  Object.assign(db, seedState())
  persist()
}

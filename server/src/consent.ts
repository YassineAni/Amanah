import type { Checkin, CheckinAccess, ClinicalFile, Person } from './types.js'

/**
 * THE consent enforcement point. Now server-side — the frontend never receives
 * a hidden transcript, so this IS a real boundary (unlike the client-only
 * version in the earlier prototype).
 *
 *   'full' -> caller may see transcript, translation, audio, visibility
 *   'mood' -> caller may see only the mood
 *   'none' -> caller sees nothing (currently unreachable; reserved)
 */
export function visibleCheckin(c: Checkin, viewer: Person): CheckinAccess {
  if (viewer.id === c.authorId) return 'full' // the elder always sees her own

  switch (c.visibility) {
    case 'circle':
      return 'full'
    case 'family':
      return viewer.isFamily ? 'full' : 'mood'
    case 'coordinator':
      return viewer.role === 'coordinator' ? 'full' : 'mood'
    case 'mood-only':
      return 'mood'
    default:
      return 'mood'
  }
}

/** Shape a check-in for the wire, stripping anything the viewer may not see. */
export function serializeCheckin(c: Checkin, viewer: Person, audioUrl: string) {
  const access = visibleCheckin(c, viewer)
  const base = {
    id: c.id,
    date: c.date,
    createdVia: c.createdVia,
    access,
    mood: access === 'none' ? null : c.mood,
    /** true when a note exists that this viewer may not read */
    noteHidden: access !== 'full',
  }
  if (access !== 'full') return base
  return {
    ...base,
    transcript: c.transcript,
    translation: c.translation,
    spokenLang: c.spokenLang,
    audioUrl,
    // visibility control is only meaningful to the owner
    visibility: viewer.id === c.authorId ? c.visibility : undefined,
  }
}

/**
 * Whether a viewer may see a clinical file. Same idea as check-ins:
 * the elder owns her record; a hired caregiver never sees family-only docs.
 */
export function visibleFile(f: ClinicalFile, viewer: Person): boolean {
  if (viewer.role === 'elder') return true
  switch (f.visibility) {
    case 'circle':
      return true
    case 'family':
      return viewer.isFamily
    case 'coordinator':
      return viewer.role === 'coordinator'
    default:
      return false
  }
}

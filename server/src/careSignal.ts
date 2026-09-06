import type { ActivityTag, Checkin, Mood, Person, Shift } from './types.js'
import { demoDay } from './seed.js'
import { visibleCheckin } from './consent.js'

export const WINDOW_OFFSETS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4]

export interface StripDay {
  date: string
  offset: number
  isPast: boolean
  mood: Mood | null
  noteHidden: boolean
  checkinId: string | null
  shifts: { caregiverName: string | null; tags: ActivityTag[] }[]
}

function latestCheckinFor(date: string, checkins: Checkin[]): Checkin | null {
  const day = checkins.filter((c) => c.date === date)
  return day.length ? day[day.length - 1] : null
}

export function weekStrip(
  people: Person[],
  shifts: Shift[],
  checkins: Checkin[],
  viewer: Person,
): StripDay[] {
  return WINDOW_OFFSETS.map((offset) => {
    const date = demoDay(offset)
    const c = latestCheckinFor(date, checkins)
    let mood: Mood | null = null
    let noteHidden = false
    if (c) {
      const access = visibleCheckin(c, viewer)
      mood = access === 'none' ? null : c.mood
      noteHidden = access !== 'full'
    }
    const dayShifts = shifts
      .filter((s) => s.start.slice(0, 10) === date)
      .map((s) => ({
        caregiverName: people.find((p) => p.id === s.caregiverId)?.name ?? null,
        tags: s.activityTags,
      }))
    return {
      date,
      offset,
      isPast: offset <= 0,
      mood,
      noteHidden: noteHidden && !!c,
      checkinId: c?.id ?? null,
      shifts: dayShifts,
    }
  })
}

const TAGS: ActivityTag[] = [
  'garden', 'outing', 'physio', 'companionship', 'personal-care', 'errands',
]

/** Deterministic, non-causal. Guard: >=3 good and >=2 hard days in window. */
export function correlationCallout(
  shifts: Shift[],
  checkins: Checkin[],
): string | null {
  const rows = WINDOW_OFFSETS.filter((o) => o <= 0)
    .map(demoDay)
    .map((date) => {
      const c = latestCheckinFor(date, checkins)
      if (!c) return null
      const tags = new Set<ActivityTag>()
      shifts
        .filter((s) => s.start.slice(0, 10) === date)
        .forEach((s) => s.activityTags.forEach((t) => tags.add(t)))
      return { mood: c.mood, tags }
    })
    .filter((x): x is { mood: Mood; tags: Set<ActivityTag> } => x !== null)

  const good = rows.filter((r) => r.mood === 'good')
  const hard = rows.filter((r) => r.mood === 'hard')
  if (good.length < 3 || hard.length < 2) return null

  type Cand = { label: string; score: number; kind: 'good' | 'hard' }
  const cands: Cand[] = []
  for (const tag of TAGS) {
    const gr = good.filter((r) => r.tags.has(tag)).length / good.length
    const hr = hard.filter((r) => r.tags.has(tag)).length / hard.length
    if (gr >= 0.6 && hr <= 0.34)
      cands.push({
        label: `${good.filter((r) => r.tags.has(tag)).length} of her ${good.length} good days this week included ${tagLabel(tag)}.`,
        score: gr - hr,
        kind: 'good',
      })
    if (hr >= 0.6 && gr <= 0.34)
      cands.push({
        label: `${hard.filter((r) => r.tags.has(tag)).length} of her ${hard.length} hard days this week had no ${tagLabel(tag)}.`,
        score: hr - gr,
        kind: 'hard',
      })
  }
  if (!cands.length) return null
  cands.sort((a, b) => b.score - a.score || (a.kind === 'good' ? -1 : 1))
  return cands[0].label
}

function tagLabel(t: ActivityTag): string {
  return t === 'garden' ? 'time in the garden'
    : t === 'outing' ? 'an outing'
    : t === 'physio' ? 'physiotherapy'
    : t === 'companionship' ? 'companionship time'
    : t === 'personal-care' ? 'personal care'
    : 'errands'
}

export interface ShiftHeaderContext {
  date: string | null
  mood: Mood | null
  excerpt: string | null
  noteHidden: boolean
}

export function shiftHeaderContext(
  checkins: Checkin[],
  viewer: Person,
  shiftDate: string,
): ShiftHeaderContext {
  const prior = [...checkins]
    .filter((c) => c.date < shiftDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  if (!prior) return { date: null, mood: null, excerpt: null, noteHidden: false }
  const access = visibleCheckin(prior, viewer)
  if (access === 'none')
    return { date: prior.date, mood: null, excerpt: null, noteHidden: true }
  if (access === 'mood')
    return { date: prior.date, mood: prior.mood, excerpt: null, noteHidden: true }
  const text = prior.translation || prior.transcript
  return {
    date: prior.date,
    mood: prior.mood,
    excerpt: text.length > 90 ? text.slice(0, 88).trimEnd() + '…' : text,
    noteHidden: false,
  }
}

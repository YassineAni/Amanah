// Seed data. ALL FICTIONAL. Mirrors app/src/data/seed.ts — keep in sync.
import type { AdHocTask, Checkin, ClinicalFile, Completion, Person, PrayerTimes, RoutineItem, Shift } from './types.js'

export const DEMO_DATE = '2026-09-06' // a Sunday; "today" in the demo

export function demoDay(offset: number): string {
  const d = new Date(DEMO_DATE + 'T00:00:00')
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00`

export const ELDER_ID = 'elder-fatima'

// Demo sign-in: username = first name lowercase, shared password for everyone.
const PW = 'vivemdu212'
export const people: Person[] = [
  { id: ELDER_ID, name: 'Fatima', role: 'elder', isFamily: true, lang: 'ar', username: 'fatima', password: PW },
  { id: 'coord-yusuf', name: 'Yusuf', role: 'coordinator', isFamily: true, lang: 'fr', username: 'yusuf', password: PW },
  { id: 'cg-amina', name: 'Amina', role: 'caregiver', isFamily: true, lang: 'fr', username: 'amina', password: PW },
  { id: 'cg-sara', name: 'Sara', role: 'caregiver', isFamily: true, lang: 'fr', username: 'sara', password: PW },
  { id: 'cg-lea', name: 'Léa (agency)', role: 'caregiver', isFamily: false, lang: 'fr', username: 'lea', password: PW },
  { id: 'fam-mona', name: 'Mona', role: 'family', isFamily: true, lang: 'en', username: 'mona', password: PW },
  { id: 'fam-karim', name: 'Karim', role: 'family', isFamily: true, lang: 'en', username: 'karim', password: PW },
]

export const prayerTimes: PrayerTimes = {
  fajr: '05:20',
  dhuhr: '12:50',
  asr: '16:30',
  maghrib: '19:20',
  isha: '20:50',
}

export const shifts: Shift[] = [
  { id: 's-6', caregiverId: 'cg-amina', start: at(demoDay(-6), '09:00'), end: at(demoDay(-6), '13:00'), purpose: 'Morning', activityTags: ['garden'] },
  { id: 's-5', caregiverId: 'cg-lea', start: at(demoDay(-5), '13:00'), end: at(demoDay(-5), '17:00'), purpose: 'Afternoon', activityTags: ['errands'] },
  { id: 's-4', caregiverId: 'cg-amina', start: at(demoDay(-4), '09:00'), end: at(demoDay(-4), '13:00'), purpose: 'Morning', activityTags: ['garden', 'companionship'] },
  { id: 's-3', caregiverId: 'cg-amina', start: at(demoDay(-3), '10:00'), end: at(demoDay(-3), '14:00'), purpose: 'Late morning', activityTags: ['physio'] },
  { id: 's-2', caregiverId: 'cg-amina', start: at(demoDay(-2), '09:00'), end: at(demoDay(-2), '13:00'), purpose: 'Morning', activityTags: ['garden'] },
  { id: 's-1', caregiverId: 'cg-lea', start: at(demoDay(-1), '13:00'), end: at(demoDay(-1), '17:00'), purpose: 'Afternoon', activityTags: ['personal-care'] },
  { id: 's-0', caregiverId: 'cg-sara', start: at(demoDay(0), '11:00'), end: at(demoDay(0), '15:00'), purpose: 'Midday', activityTags: ['companionship'] },
  { id: 's+1', caregiverId: 'cg-lea', start: at(demoDay(1), '13:00'), end: at(demoDay(1), '17:00'), purpose: 'Afternoon', activityTags: ['errands'] },
  { id: 's+2', caregiverId: null, start: at(demoDay(2), '13:00'), end: at(demoDay(2), '17:00'), purpose: 'Afternoon', activityTags: ['garden'] },
  { id: 's+3', caregiverId: 'cg-amina', start: at(demoDay(3), '09:00'), end: at(demoDay(3), '13:00'), purpose: 'Morning', activityTags: ['companionship'], coordinatorNote: 'She lights up in the garden — take her out if the weather is kind.' },
  { id: 's+4', caregiverId: 'cg-lea', start: at(demoDay(4), '10:00'), end: at(demoDay(4), '14:00'), purpose: 'Late morning', activityTags: ['physio'] },
]

export const checkins: Checkin[] = [
  { id: 'c-6', date: demoDay(-6), authorId: ELDER_ID, mood: 'good',
    transcript: 'اليوم كان جميلاً. أمينة أخذتني إلى الحديقة وجلسنا معاً.',
    translation: 'Today was lovely. Amina took me to the garden and we sat together.',
    audioId: 'u1', spokenLang: 'ar', visibility: 'circle', createdVia: 'demo' },
  { id: 'c-5', date: demoDay(-5), authorId: ELDER_ID, mood: 'hard',
    transcript: 'يوم طويل. كثير من المشاوير ولم أسترِح.',
    translation: 'A long day. A lot of errands and I did not get to rest.',
    audioId: 'u2', spokenLang: 'ar', visibility: 'family', createdVia: 'demo' },
  { id: 'c-4', date: demoDay(-4), authorId: ELDER_ID, mood: 'good',
    transcript: 'يوم طيّب. جلسنا في الحديقة وتحدّثنا طويلاً.',
    translation: 'A good day. We sat in the garden and talked for a long time.',
    audioId: 'u1', spokenLang: 'ar', visibility: 'circle', createdVia: 'demo' },
  { id: 'c-3', date: demoDay(-3), authorId: ELDER_ID, mood: 'ok',
    transcript: 'يوم هادئ. تمارين العلاج الطبيعي أتعبتني قليلاً.',
    translation: 'A quiet day. The physiotherapy exercises tired me a little.',
    audioId: 'u3', spokenLang: 'ar', visibility: 'circle', createdVia: 'demo' },
  { id: 'c-2', date: demoDay(-2), authorId: ELDER_ID, mood: 'good',
    transcript: 'الحمد لله، يوم جميل في الحديقة مع أمينة.',
    translation: 'Alhamdulillah, a lovely day in the garden with Amina.',
    audioId: 'u1', spokenLang: 'ar', visibility: 'circle', createdVia: 'demo' },
  { id: 'c-1', date: demoDay(-1), authorId: ELDER_ID, mood: 'hard',
    transcript: 'كان يوماً صعباً. كنت متعبة وظللت أفكّر في أختي.',
    translation: 'It was a hard day. I was tired and I kept thinking about my sister.',
    audioId: 'u2', spokenLang: 'ar', visibility: 'family', createdVia: 'demo' },
  // demoDay(0): intentionally absent — recorded live in the demo.
]

// Placeholder body served for seeded files (they have no real bytes on disk).
export const PLACEHOLDER_PDF_B64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzNjAgMTQwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMTggPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAyNCA5NiBUZCAoRmljdGlvbmFsIGRlbW8gZG9jdW1lbnQuKSBUaiAwIC0yMCBUZCAoSGVyIERheSBzdG9yZXMgZmlsZXM7IGl0IGRvZXMgbm90IGludGVycHJldCB0aGVtLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA0MTAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0ODAKJSVFT0Y='

export const files: ClinicalFile[] = [
  { id: 'f-1', name: 'Discharge summary — Feb visit.pdf', category: 'discharge', visibility: 'family', uploadedById: 'coord-yusuf', uploadedByName: 'Yusuf', uploadedAt: at(demoDay(-20), '10:00'), mime: "application/pdf", size: 148213, seeded: true, scannedClean: true },
  { id: 'f-2', name: 'Blood panel — results.pdf', category: 'lab', visibility: 'coordinator', uploadedById: 'fam-mona', uploadedByName: 'Mona', uploadedAt: at(demoDay(-12), '14:30'), mime: "application/pdf", size: 92044, seeded: true, scannedClean: true },
  { id: 'f-3', name: 'Physiotherapy care plan.pdf', category: 'care-plan', visibility: 'circle', uploadedById: 'coord-yusuf', uploadedByName: 'Yusuf', uploadedAt: at(demoDay(-5), '09:15'), mime: "application/pdf", size: 61120, seeded: true, scannedClean: true },
]

// --- care plan: a weekly routine, plus demo completions + one ad-hoc task ---
const EVERYDAY = [0, 1, 2, 3, 4, 5, 6]
const MON_WED_FRI = [1, 3, 5]

export const routine: RoutineItem[] = [
  { id: 'r-med-am', title: 'Morning medication', time: '08:00', category: 'medication', timeSensitive: true, weekdays: EVERYDAY },
  { id: 'r-breakfast', title: 'Light breakfast', time: '09:00', category: 'meal', timeSensitive: false, weekdays: EVERYDAY },
  { id: 'r-physio', title: 'Physiotherapy exercises', time: '10:00', category: 'activity', timeSensitive: false, weekdays: MON_WED_FRI },
  { id: 'r-lunch', title: 'Lunch', time: '12:45', category: 'meal', timeSensitive: false, weekdays: EVERYDAY },
  { id: 'r-rest', title: 'Afternoon rest', time: '13:30', category: 'rest', timeSensitive: true, weekdays: EVERYDAY },
  { id: 'r-wash', title: 'Help with a wash', time: '14:30', category: 'personal-care', timeSensitive: true, weekdays: [1, 4] },
  { id: 'r-med-pm', title: 'Evening medication', time: '16:30', category: 'medication', timeSensitive: true, weekdays: EVERYDAY },
  { id: 'r-dinner', title: 'Dinner', time: '18:30', category: 'meal', timeSensitive: false, weekdays: EVERYDAY },
]

// DEMO_DATE (2026-09-06) is a Sunday: physio + wash don't run today.
export const completions: Completion[] = [
  { id: 'cp-1', routineItemId: 'r-med-am', date: DEMO_DATE, doneAt: `${DEMO_DATE}T08:12:00`, doneById: 'cg-amina', doneByName: 'Amina' },
  { id: 'cp-2', routineItemId: 'r-breakfast', date: DEMO_DATE, doneAt: `${DEMO_DATE}T09:20:00`, doneById: 'cg-amina', doneByName: 'Amina' },
  { id: 'cp-3', routineItemId: 'r-lunch', date: DEMO_DATE, doneAt: `${DEMO_DATE}T13:05:00`, doneById: 'cg-sara', doneByName: 'Sara', note: 'Ate most of it, in good spirits.' },
]

export const adHoc: AdHocTask[] = [
  { id: 'ah-1', date: DEMO_DATE, title: 'Called her sister', time: '15:10', category: 'activity', timeSensitive: false, addedById: 'cg-sara', addedByName: 'Sara', doneAt: `${DEMO_DATE}T15:12:00`, doneById: 'cg-sara', doneByName: 'Sara', note: 'She asked to ring Nadia — chatted about 20 minutes.' },
]

export interface Utterance {
  id: string
  label: string
  spokenLang: 'ar'
  transcript: string
  translation: string
}

export const utterances: Utterance[] = [
  { id: 'u1', label: 'Good day — garden with Amina', spokenLang: 'ar',
    transcript: 'اليوم كان جميلاً. أمينة أخذتني إلى الحديقة وجلسنا معاً.',
    translation: 'Today was lovely. Amina took me to the garden and we sat together.' },
  { id: 'u2', label: 'Hard day — tired, thinking of my sister', spokenLang: 'ar',
    transcript: 'كان يوماً صعباً. كنت متعبة وظللت أفكّر في أختي.',
    translation: 'It was a hard day. I was tired and I kept thinking about my sister.' },
  { id: 'u3', label: 'Quiet day — it was fine', spokenLang: 'ar',
    transcript: 'كان يوماً هادئاً، لا بأس.',
    translation: 'It was a quiet day, not bad.' },
]

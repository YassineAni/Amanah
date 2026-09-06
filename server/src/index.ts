import './loadEnv.js' // must be first — populates process.env from server/.env
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, resolve } from 'node:path'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import type { AuthedRequest } from './auth.js'
import { makeToken, requireAuth, requireRole, resolveLogin } from './auth.js'
import { toPublicPerson } from './types.js'
import { db, persist, reset } from './db.js'
import { serializeCheckin, visibleCheckin, visibleFile } from './consent.js'
import {
  WINDOW_OFFSETS,
  correlationCallout,
  shiftHeaderContext,
  weekStrip,
} from './careSignal.js'
import { demoTranscribe, liveTranscribe } from './transcribe.js'
import { scanFile } from './scan.js'
import {
  DEMO_DATE,
  demoDay,
  ELDER_ID,
  PLACEHOLDER_PDF_B64,
  prayerTimes,
  utterances,
} from './seed.js'
import { expandDay } from './plan.js'
import type {
  ActivityTag,
  AdHocTask,
  CheckinVisibility,
  ClinicalFile,
  Completion,
  FileCategory,
  FileVisibility,
  Lang,
  Mood,
  RoutineItem,
  TaskCategory,
} from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIO_DIR = resolve(__dirname, '../audio')
const UPLOAD_DIR = resolve(AUDIO_DIR, 'uploads')
const TTS_DIR = resolve(AUDIO_DIR, 'tts')
const FILES_DIR = resolve(__dirname, '../files')
mkdirSync(UPLOAD_DIR, { recursive: true })
mkdirSync(TTS_DIR, { recursive: true })
mkdirSync(FILES_DIR, { recursive: true })
const PORT = Number(process.env.PORT) || 8787

const FILE_MIME_OK = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
])
const FILE_CATS: FileCategory[] = ['discharge', 'prescription', 'lab', 'imaging', 'care-plan', 'other']
const FILE_VIS: FileVisibility[] = ['circle', 'family', 'coordinator']

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('ogg')) return '.ogg'
  return '.webm'
}

const app = express()
// CORS_ORIGIN: "*" / unset -> allow all; otherwise a comma-list of exact origins.
const corsEnv = process.env.CORS_ORIGIN?.trim()
app.use(
  cors({
    origin: !corsEnv || corsEnv === '*' ? true : corsEnv.split(',').map((s) => s.trim()),
  }),
)
app.use(express.json())
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, FILE_MIME_OK.has(file.mimetype)),
})

// live-uploaded audio, kept in memory (demo scale)
const audioStore = new Map<string, { buf: Buffer; mime: string }>()
const audioUrl = (id: string) => `/api/audio/${id}`
const SAFE_ID = /^[A-Za-z0-9_-]+$/

// naive per-token throttle on the paid endpoint (belt-and-braces alongside the
// OpenAI spending cap — see docs/guardrails.md #10)
const rl = new Map<string, number[]>()
function throttle(token: string, max = 20, windowMs = 5 * 60_000): boolean {
  const now = Date.now()
  const hits = (rl.get(token) ?? []).filter((t) => now - t < windowMs)
  hits.push(now)
  rl.set(token, hits)
  return hits.length <= max
}

// --- meta ------------------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, demoDate: DEMO_DATE }))

app.get('/api/prayer-times', (_req, res) => res.json(prayerTimes))

app.get('/api/demo/utterances', (_req, res) =>
  res.json(utterances.map((u) => ({ id: u.id, label: u.label }))),
)

// reset to seed — for demo rehearsal
app.post('/api/demo/reset', (_req, res) => {
  reset()
  res.json({ ok: true })
})

// --- audio (PUBLIC: fictional demo audio; <audio> can't send auth headers) ---

app.get('/api/audio/:id', (req, res) => {
  const id = req.params.id
  if (!SAFE_ID.test(id)) return res.status(400).end()
  const live = audioStore.get(id)
  if (live) {
    res.type(live.mime).send(live.buf)
    return
  }
  // demo utterance files: audio/<id>.wav (silent placeholders until recorded)
  const demoFile = resolve(AUDIO_DIR, `${id}.wav`)
  if (existsSync(demoFile)) {
    res.type('audio/wav').send(readFileSync(demoFile))
    return
  }
  // persisted live uploads: audio/uploads/<id>.<ext> (survive a restart)
  try {
    const match = readdirSync(UPLOAD_DIR).find((f) => f.startsWith(id + '.'))
    if (match) {
      const ext = extname(match).slice(1)
      res.type(ext === 'm4a' ? 'audio/mp4' : ext).send(readFileSync(resolve(UPLOAD_DIR, match)))
      return
    }
  } catch {
    /* fall through */
  }
  res.status(404).end()
})

// --- auth (DEMO ONLY — password is "123" for every seeded user) -----------

app.post('/api/auth/login', (req, res) => {
  const { username, password, userId } = req.body as {
    username?: string
    password?: string
    userId?: string
  }
  const user = resolveLogin({ username, password, userId })
  if (!user) return res.status(401).json({ error: 'wrong username or password' })
  res.json({ token: makeToken(user.id), user: toPublicPerson(user) })
})

app.get('/api/session', requireAuth, (req: AuthedRequest, res) =>
  res.json({ user: toPublicPerson(req.user!) }),
)

// everything below needs a session
app.use('/api', requireAuth)

// --- people / schedule --------------------------------------------------

app.get('/api/people', (_req, res) =>
  res.json(db.people.map(toPublicPerson)),
)

app.get('/api/shifts', (_req, res) => {
  const withNames = db.shifts.map((s) => ({
    ...s,
    caregiverName: db.people.find((p) => p.id === s.caregiverId)?.name ?? null,
  }))
  res.json(withNames)
})

app.patch(
  '/api/shifts/:id',
  requireRole('coordinator'),
  (req, res) => {
    const shift = db.shifts.find((s) => s.id === req.params.id)
    if (!shift) return res.status(404).json({ error: 'no such shift' })
    const { caregiverId, activityTags, coordinatorNote } = req.body as {
      caregiverId?: string | null
      activityTags?: ActivityTag[]
      coordinatorNote?: string
    }
    if (caregiverId !== undefined) {
      if (caregiverId && !db.people.some((p) => p.id === caregiverId && p.role === 'caregiver'))
        return res.status(400).json({ error: 'not a caregiver' })
      shift.caregiverId = caregiverId
    }
    if (activityTags !== undefined) shift.activityTags = activityTags
    if (coordinatorNote !== undefined) shift.coordinatorNote = coordinatorNote.slice(0, 400)
    persist()
    res.json({ ...shift, caregiverName: db.people.find((p) => p.id === shift.caregiverId)?.name ?? null })
  },
)

// --- check-ins (consent enforced here) --------------------------------

app.get('/api/checkins', (req: AuthedRequest, res) => {
  const viewer = req.user!
  const list = [...db.checkins]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((c) => serializeCheckin(c, viewer, audioUrl(c.audioId)))
  res.json(list)
})

// preview transcription before saving
app.post(
  '/api/transcribe',
  requireRole('elder'),
  upload.single('audio'),
  async (req, res) => {
    const token = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!throttle(token))
      return res.status(429).json({ error: 'too many transcription requests, slow down' })
    const spokenLang = ((req.body?.spokenLang as Lang) ??
      db.people.find((p) => p.id === ELDER_ID)?.lang ??
      'ar') as Lang
    try {
      if (req.body?.demoUtteranceId) {
        const r = demoTranscribe(req.body.demoUtteranceId)
        return res.json({ ...r, audioId: req.body.demoUtteranceId, audioUrl: audioUrl(req.body.demoUtteranceId) })
      }
      if (!req.file) return res.status(400).json({ error: 'no audio and no demoUtteranceId' })
      const mime = req.file.mimetype || 'audio/webm'
      const r = await liveTranscribe(req.file.buffer, req.file.originalname || 'audio.webm', mime, spokenLang)
      const id = `a-${Date.now()}`
      audioStore.set(id, { buf: req.file.buffer, mime })
      // also persist to disk so the recording survives a server restart
      try {
        writeFileSync(resolve(UPLOAD_DIR, id + extFor(mime)), req.file.buffer)
      } catch {
        /* memory copy is enough for the session */
      }
      res.json({ ...r, audioId: id, audioUrl: audioUrl(id) })
    } catch (e) {
      res.status(502).json({ error: (e as Error).message })
    }
  },
)

// save a check-in
app.post('/api/checkins', requireRole('elder'), (req: AuthedRequest, res) => {
  const b = req.body as {
    date?: string
    mood?: Mood
    transcript?: string
    translation?: string
    audioId?: string
    spokenLang?: Lang
    visibility?: CheckinVisibility
    createdVia?: 'live' | 'demo'
  }
  if (!b.mood || !b.transcript)
    return res.status(400).json({ error: 'mood and transcript required' })
  const c = {
    id: `c-${Date.now()}`,
    date: b.date ?? DEMO_DATE,
    authorId: ELDER_ID,
    mood: b.mood,
    transcript: b.transcript,
    translation: b.translation ?? b.transcript,
    audioId: b.audioId ?? '',
    spokenLang: b.spokenLang ?? 'ar',
    visibility: b.visibility ?? 'family', // default
    createdVia: b.createdVia ?? 'demo',
  }
  db.checkins.push(c)
  persist()
  res.status(201).json(serializeCheckin(c, req.user!, audioUrl(c.audioId)))
})

app.patch(
  '/api/checkins/:id/visibility',
  requireRole('elder'),
  (req: AuthedRequest, res) => {
    const c = db.checkins.find((x) => x.id === req.params.id)
    if (!c) return res.status(404).json({ error: 'no such check-in' })
    if (c.authorId !== req.user!.id)
      return res.status(403).json({ error: 'not your check-in' })
    const { visibility } = req.body as { visibility?: CheckinVisibility }
    const allowed: CheckinVisibility[] = ['circle', 'family', 'coordinator', 'mood-only']
    if (!visibility || !allowed.includes(visibility))
      return res.status(400).json({ error: 'bad visibility' })
    c.visibility = visibility
    persist()
    res.json(serializeCheckin(c, req.user!, audioUrl(c.audioId)))
  },
)

// --- clinical files (STORED, never interpreted) ----------------------------

function canManageFile(user: AuthedRequest['user'], f: ClinicalFile): boolean {
  return !!user && (user.role === 'coordinator' || user.id === f.uploadedById)
}

app.get('/api/files', (req: AuthedRequest, res) => {
  const viewer = req.user!
  const list = db.files
    .filter((f) => visibleFile(f, viewer))
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
    .map((f) => ({ ...f, canManage: canManageFile(viewer, f) }))
  res.json({
    files: list,
    canUpload: viewer.role === 'coordinator' || viewer.role === 'family',
  })
})

app.post(
  '/api/files',
  (req: AuthedRequest, res, next) => {
    if (req.user!.role === 'coordinator' || req.user!.role === 'family') return next()
    return res.status(403).json({ error: 'only the coordinator or family can upload' })
  },
  fileUpload.single('file'),
  (req: AuthedRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file, or its type is not allowed' })

    // scan before we store or expose it (structure + signature + heuristics)
    const scan = scanFile(req.file.buffer, req.file.mimetype)
    if (!scan.ok) return res.status(422).json({ error: scan.reason ?? 'This file did not pass the safety check.' })

    const b = req.body as { name?: string; category?: string; visibility?: string }
    const category = (FILE_CATS as string[]).includes(b.category ?? '')
      ? (b.category as FileCategory)
      : 'other'
    const visibility = (FILE_VIS as string[]).includes(b.visibility ?? '')
      ? (b.visibility as FileVisibility)
      : 'family'
    const id = `f-${Date.now()}`
    const ext = extname(req.file.originalname) || guessExt(req.file.mimetype)
    try {
      writeFileSync(resolve(FILES_DIR, id + ext), req.file.buffer)
    } catch {
      return res.status(500).json({ error: 'could not store the file' })
    }
    const f: ClinicalFile = {
      id,
      name: (b.name?.trim() || req.file.originalname || 'document').slice(0, 160),
      category,
      visibility,
      uploadedById: req.user!.id,
      uploadedByName: req.user!.name,
      uploadedAt: new Date().toISOString(),
      mime: req.file.mimetype,
      size: req.file.size,
      scannedClean: true,
    }
    db.files.push(f)
    persist()
    res.status(201).json({ ...f, canManage: canManageFile(req.user!, f) })
  },
)

app.patch('/api/files/:id', (req: AuthedRequest, res) => {
  const f = db.files.find((x) => x.id === req.params.id)
  if (!f) return res.status(404).json({ error: 'no such file' })
  if (!canManageFile(req.user!, f)) return res.status(403).json({ error: 'not allowed' })
  const b = req.body as { name?: string; category?: string; visibility?: string }
  if (b.name !== undefined) f.name = b.name.trim().slice(0, 160) || f.name
  if (b.category && (FILE_CATS as string[]).includes(b.category)) f.category = b.category as FileCategory
  if (b.visibility && (FILE_VIS as string[]).includes(b.visibility)) f.visibility = b.visibility as FileVisibility
  persist()
  res.json({ ...f, canManage: true })
})

app.delete('/api/files/:id', (req: AuthedRequest, res) => {
  const f = db.files.find((x) => x.id === req.params.id)
  if (!f) return res.status(404).json({ error: 'no such file' })
  if (!canManageFile(req.user!, f)) return res.status(403).json({ error: 'not allowed' })
  db.files = db.files.filter((x) => x.id !== f.id)
  if (!f.seeded) {
    try {
      const match = readdirSync(FILES_DIR).find((n) => n.startsWith(f.id + '.'))
      if (match) writeFileSync(resolve(FILES_DIR, match), Buffer.alloc(0))
    } catch {
      /* best effort */
    }
  }
  persist()
  res.json({ ok: true })
})

app.get('/api/files/:id/download', (req: AuthedRequest, res) => {
  const f = db.files.find((x) => x.id === req.params.id)
  if (!f) return res.status(404).end()
  if (!visibleFile(f, req.user!)) return res.status(403).json({ error: 'not permitted' })
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`)
  if (f.seeded) {
    res.type('application/pdf').send(Buffer.from(PLACEHOLDER_PDF_B64, 'base64'))
    return
  }
  try {
    const match = readdirSync(FILES_DIR).find((n) => n.startsWith(f.id + '.'))
    if (!match) return res.status(404).end()
    res.type(f.mime).send(readFileSync(resolve(FILES_DIR, match)))
  } catch {
    res.status(404).end()
  }
})

function guessExt(mime: string): string {
  if (mime === 'application/pdf') return '.pdf'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'text/plain') return '.txt'
  return '.bin'
}

// --- care plan: weekly routine + per-day completions + ad-hoc tasks -------
// Observations only. Nothing here is clinical: no dosages, no advice.

const TASK_CATS: TaskCategory[] = ['medication', 'personal-care', 'meal', 'rest', 'activity', 'other']
const isCat = (v?: string): v is TaskCategory => (TASK_CATS as string[]).includes(v ?? '')
const isTime = (v?: string) => /^\d{2}:\d{2}$/.test(v ?? '')
const isWeekdays = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)

// GET the expanded plan for a day (Daily view / caregiver / family)
app.get('/api/tasks', (req: AuthedRequest, res) => {
  const date = (req.query.date as string) || DEMO_DATE
  res.json({ date, tasks: expandDay(date, db.routine, db.completions, db.adHoc) })
})

// tick a task done/undone for a day (routine -> completion row; adhoc -> flags)
app.patch('/api/tasks/toggle', (req: AuthedRequest, res) => {
  const u = req.user!
  if (u.role !== 'caregiver' && u.role !== 'coordinator')
    return res.status(403).json({ error: 'only a caregiver or the coordinator can update tasks' })
  const { date, key, done, note } = req.body as {
    date?: string
    key?: string
    done?: boolean
    note?: string
  }
  if (!date || !key) return res.status(400).json({ error: 'date and key required' })
  const trimmedNote = typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined

  if (key.startsWith('r:')) {
    const routineItemId = key.slice(2)
    if (!db.routine.some((r) => r.id === routineItemId))
      return res.status(404).json({ error: 'no such routine item' })
    const existing = db.completions.find((c) => c.routineItemId === routineItemId && c.date === date)
    if (done) {
      if (existing) {
        existing.note = trimmedNote ?? existing.note
      } else {
        db.completions.push({
          id: `cp-${Date.now()}`,
          routineItemId,
          date,
          doneAt: new Date().toISOString(),
          doneById: u.id,
          doneByName: u.name,
          note: trimmedNote,
        })
      }
    } else {
      db.completions = db.completions.filter((c) => c !== existing)
    }
  } else if (key.startsWith('a:')) {
    const a = db.adHoc.find((x) => x.id === key.slice(2))
    if (!a) return res.status(404).json({ error: 'no such task' })
    if (done) {
      a.doneAt = new Date().toISOString()
      a.doneById = u.id
      a.doneByName = u.name
      if (trimmedNote) a.note = trimmedNote
    } else {
      a.doneAt = null
      a.doneById = null
      a.doneByName = null
    }
  } else {
    return res.status(400).json({ error: 'bad key' })
  }
  persist()
  res.json({ date, tasks: expandDay(date, db.routine, db.completions, db.adHoc) })
})

// add a one-off for a specific day
app.post('/api/tasks/adhoc', (req: AuthedRequest, res) => {
  const u = req.user!
  if (u.role !== 'caregiver' && u.role !== 'coordinator')
    return res.status(403).json({ error: 'only a caregiver or the coordinator can add tasks' })
  const b = req.body as {
    date?: string
    title?: string
    time?: string
    category?: string
    timeSensitive?: boolean
    note?: string
  }
  if (!b.title?.trim() || !isTime(b.time))
    return res.status(400).json({ error: 'title and a HH:MM time are required' })
  const a: AdHocTask = {
    id: `ah-${Date.now()}`,
    date: b.date ?? DEMO_DATE,
    title: b.title.trim().slice(0, 120),
    time: b.time!,
    category: isCat(b.category) ? b.category : 'other',
    timeSensitive: !!b.timeSensitive,
    addedById: u.id,
    addedByName: u.name,
    doneAt: null,
    doneById: null,
    doneByName: null,
    note: typeof b.note === 'string' ? b.note.trim().slice(0, 300) || undefined : undefined,
  }
  db.adHoc.push(a)
  persist()
  res.status(201).json({ date: a.date, tasks: expandDay(a.date, db.routine, db.completions, db.adHoc) })
})

app.delete('/api/tasks/adhoc/:id', (req: AuthedRequest, res) => {
  const u = req.user!
  const a = db.adHoc.find((x) => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'no such task' })
  if (u.role !== 'coordinator' && a.addedById !== u.id)
    return res.status(403).json({ error: 'not allowed' })
  db.adHoc = db.adHoc.filter((x) => x.id !== a.id)
  persist()
  res.json({ ok: true })
})

// --- the routine (Weekly setup — coordinator only) ----------------------

app.get('/api/routine', (_req, res) => {
  res.json([...db.routine].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)))
})

app.post('/api/routine', requireRole('coordinator'), (req, res) => {
  const b = req.body as {
    title?: string
    time?: string
    category?: string
    timeSensitive?: boolean
    weekdays?: number[]
  }
  if (!b.title?.trim() || !isTime(b.time) || !isWeekdays(b.weekdays))
    return res.status(400).json({ error: 'title, HH:MM time and weekdays[] are required' })
  const item: RoutineItem = {
    id: `r-${Date.now()}`,
    title: b.title.trim().slice(0, 120),
    time: b.time!,
    category: isCat(b.category) ? b.category : 'other',
    timeSensitive: !!b.timeSensitive,
    weekdays: [...new Set(b.weekdays)].sort(),
  }
  db.routine.push(item)
  persist()
  res.status(201).json(item)
})

app.patch('/api/routine/:id', requireRole('coordinator'), (req, res) => {
  const item = db.routine.find((r) => r.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'no such routine item' })
  const b = req.body as Partial<RoutineItem>
  if (typeof b.title === 'string' && b.title.trim()) item.title = b.title.trim().slice(0, 120)
  if (isTime(b.time)) item.time = b.time!
  if (isCat(b.category)) item.category = b.category
  if (typeof b.timeSensitive === 'boolean') item.timeSensitive = b.timeSensitive
  if (isWeekdays(b.weekdays)) item.weekdays = [...new Set(b.weekdays)].sort()
  persist()
  res.json(item)
})

app.delete('/api/routine/:id', requireRole('coordinator'), (req, res) => {
  const before = db.routine.length
  db.routine = db.routine.filter((r) => r.id !== req.params.id)
  if (db.routine.length === before) return res.status(404).json({ error: 'no such routine item' })
  db.completions = db.completions.filter((c) => c.routineItemId !== req.params.id)
  persist()
  res.json({ ok: true })
})

// --- assembled views --------------------------------------------------

app.get('/api/care-signal', (req: AuthedRequest, res) => {
  const viewer = req.user!
  res.json({
    demoDate: DEMO_DATE,
    windowOffsets: WINDOW_OFFSETS,
    days: weekStrip(db.people, db.shifts, db.checkins, viewer),
    callout: correlationCallout(db.shifts, db.checkins),
  })
})

app.get('/api/my-shift', requireRole('caregiver'), (req: AuthedRequest, res) => {
  const me = req.user!
  const shift = db.shifts
    .filter((s) => s.caregiverId === me.id && s.start.slice(0, 10) >= DEMO_DATE)
    .sort((a, b) => (a.start < b.start ? -1 : 1))[0]
  if (!shift) return res.json({ shift: null, context: null })
  res.json({
    shift: { ...shift, caregiverName: me.name },
    context: shiftHeaderContext(db.checkins, me, shift.start.slice(0, 10)),
  })
})

// --- text-to-speech (read-aloud for the elder; OpenAI tts-1, disk-cached) ---

app.post('/api/tts', async (req, res) => {
  const { text, lang } = req.body as { text?: string; lang?: Lang }
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' })
  if (text.length > 800)
    return res.status(400).json({ error: 'text too long (max 800 chars)' })

  const voice = 'nova'
  const hash = createHash('sha1')
    .update(`${voice}|${lang ?? 'en'}|${text}`)
    .digest('hex')
  const file = resolve(TTS_DIR, `${hash}.mp3`)

  if (existsSync(file)) {
    res.type('audio/mpeg').send(readFileSync(file))
    return
  }

  const token = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!throttle(token, 60)) // generous: UI labels, many small calls
    return res.status(429).json({ error: 'too many read-aloud requests' })

  const KEY = process.env.OPENAI_API_KEY
  if (!KEY) return res.status(502).json({ error: 'OPENAI_API_KEY not set' })

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'mp3' }),
    })
    if (!r.ok) return res.status(502).json({ error: `tts failed (${r.status})` })
    const buf = Buffer.from(await r.arrayBuffer())
    try {
      writeFileSync(file, buf)
    } catch {
      /* cache is best-effort */
    }
    res.type('audio/mpeg').send(buf)
  } catch (e) {
    res.status(502).json({ error: (e as Error).message })
  }
})

// --- helper for the frontend: today's date & whether a check-in exists --

app.get('/api/today', (_req, res) => {
  res.json({
    date: DEMO_DATE,
    hasCheckin: db.checkins.some((c) => c.date === DEMO_DATE),
    prayerTimes,
    pastWindow: WINDOW_OFFSETS.filter((o) => o <= 0).map(demoDay),
  })
})

app.listen(PORT, () => {
  console.log(`Her Day API on http://localhost:${PORT}  (demo date ${DEMO_DATE})`)
  if (!process.env.OPENAI_API_KEY)
    console.log('  !! no OPENAI_API_KEY set — live transcription will 502; set it in server/.env for the demo')
  else console.log('  live transcription ready (OpenAI Whisper)')
  if (existsSync(resolve(__dirname, '../data.json')))
    console.log('  data.json present — it overrides seed.ts. Delete it to reseed.')
})

export { visibleCheckin } // for tests

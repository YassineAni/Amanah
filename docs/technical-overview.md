# Her Day — technical overview

*For judges and reviewers. How the system is built and why. ~2 pages.*
Companion docs: `design.md` (build notes), `data-model.md`, `guardrails.md`,
`../HANDOFF-FOR-REPLIT.md` (frontend spec), `demo-script.md`.

---

## What it is

An elder-care app built around one loop. Each evening the elder records a short
spoken account of her day, in her own language. It is transcribed, it trends on a
week strip, and that strip sits **directly beside the care schedule** —
caregivers and activities in the same columns. The coordinator reads the pattern
and changes next week's schedule in response.

**The thesis:** elder care measures only what goes wrong (falls, missed meds). No
product treats the elder's own felt experience of her days as a signal that
*steers* care. Mood check-ins exist elsewhere; what does not exist is the loop
**closing** — her words visibly reshaping the plan. That closing is the whole
product, and the 90-second demo is built to show it happening on screen.

---

## Architecture

```
   +---------------------------+        HTTPS / JSON         +----------------------------+
   |  FRONTEND  (Replit, WIP)  |  <---------------------->   |  server/  Express API       |
   |  React + TS + Tailwind    |    Authorization: Bearer    |  (Node, tsx, no build step) |
   |  4 persona screens        |                            |                            |
   |  Bearer token in memory   |                            |  +----------------------+  |
   +---------------------------+                            |  | in-memory state      |  |
                                                           |  | people/shifts/       |  |
   LIVE is the default: real mic -> real Whisper.           |  | checkins             |  |
   ?demo=1 on any route = seeded utterances, NO OpenAI      |  | persisted -> data.json|  |
   call -> a fallback if the venue wifi dies.               |  +----------+-----------+  |
                                                           |             |              |
                                                           |     consent.ts  <-- every  |
                                                           |     serializeCheckin()     |
                                                           |     read passes through    |
                                                           |             |              |
                                                           |     careSignal.ts          |
                                                           |     weekStrip + callout    |
                                                           +-------------+--------------+
                                                                         |
                                                            live mode only |  POST audio
                                                                         v
                                                           +----------------------------+
                                                           |  OpenAI Whisper            |
                                                           |  transcription + translate |
                                                           |  (API key ONLY on server)  |
                                                           +----------------------------+
```

Two prototypes exist. `app/` is a self-contained Vite/React SPA with an in-memory
store (built first, still runnable). `server/` is the real backend; the Replit
frontend is being built against `../HANDOFF-FOR-REPLIT.md` and will replace
`app/`'s UI. This doc describes the `server/`-backed system.

**The frontend is four route-apps, not one app with a switcher:** `/` (elder),
`/coordinator`, `/caregiver`, `/family`. Each silently signs in as its seed user
on load — no login screen, no "choose user" control. For the demo you keep four
browser tabs open. The coordinator app is deliberately **not** a calendar grid:
it leads with a plain-language "read" of her week, a horizontal mood ribbon, and
1–3 one-tap "suggested move" cards; acting on a card re-fetches the signal and
the read + ribbon recompute on screen — that recompute is the loop closing.

---

## Data model

Four objects, nothing clinical (`server/src/types.ts`, `data-model.md`).

| Object | Shape |
|---|---|
| **Person** | `id, name, role, isFamily, lang`. **`role` and `isFamily` are orthogonal**: `role` (`elder`/`coordinator`/`caregiver`/`family`) decides the screen; `isFamily` (a hired caregiver is `false`) decides the `family` consent gate. So the coordinator can be a family member (he is, in the seed) without special-casing. |
| **Shift** | `id, caregiverId|null, start, end, purpose, activityTags[]`. Tags: `garden, outing, physio, companionship, personal-care, errands`. This is the substrate the check-ins are read against. |
| **Checkin** | `id, date, authorId (always the elder), mood (good|ok|hard), transcript, translation, audioId, spokenLang, visibility, createdVia (live|demo)`. **No score, no numeric scale, no derived index — ever.** |
| **PrayerTimes** | `{fajr,dhuhr,asr,maghrib,isha}` as `HH:MM`, hardcoded for `DEMO_DATE`. |

**The 4 personas** (seed users): Elder → *Fatima*. Coordinator → *Yusuf*
(also family). Caregiver → *Amina* (family) / *Léa (agency)* (hired). Family →
*Mona, Karim*, and any number more — one shared read-only view.

**Deliberate shortcuts** (named so nobody mistakes them for the design):

- **One elder, hardcoded** (`ELDER_ID`). No `Circle` entity, no `elderId` on
  `Person` — everyone is implicitly in Fatima's circle. Single-elder only.
- **One role per person.** A sibling who both coordinates *and* covers shifts
  can't be modelled; `requireRole('caregiver')` would 403 a coordinator.
- **No database.** In-memory state, mirrored to `data.json` on every write.
  Restart with the file deleted → fresh seed. `POST /api/demo/reset` restores
  seed mid-session. *Footgun: while `data.json` exists it shadows `seed.ts` —
  delete it after editing the seed.*

---

## Consent — enforced on the server

Every check-in carries a `visibility`: `circle` | `family` | `coordinator` |
`mood-only` (default `family`). Set and changed **only by the elder**.

`server/src/consent.ts` has one function, `visibleCheckin(checkin, viewer) →
'full' | 'mood' | 'none'`, and `serializeCheckin()` calls it on **every** read
path (`GET /api/checkins`, `/api/care-signal`, `/api/my-shift`). When access
isn't `full`, the response object simply **does not contain** `transcript`,
`translation`, `audioUrl`, or `visibility`. The wire never carries words the
caller may not see — so this is a real boundary, not a UI trick (the earlier
`app/`-only version filtered client-side and was not).

| `visibility` | elder (author) | coordinator (Yusuf, family) | caregiver — family (Amina) | caregiver — hired (Léa) | family (Mona) |
|---|---|---|---|---|---|
| `circle` | full | full | full | full | full |
| `family` | full | full\* | full | **mood** | full |
| `coordinator` | full | full | **mood** | **mood** | **mood** |
| `mood-only` | full | **mood** | **mood** | **mood** | **mood** |

\* The `family` row keys off `isFamily`, not role — Yusuf is a family member, so
he reads `family` notes. The demo's "words disappear" beat therefore uses
`mood-only`, which hides words from everyone but the elder. The mood marker
**always** renders on the strip regardless of access — a privacy choice never
breaks the trend.

**Honest caveat — demo auth.** `POST /api/auth/login {userId}` returns a token
that is just `base64url(userId)`, no password. Anyone can mint a token for any
seed user. Fine for a fictional-data demo, stated out loud; a real build needs
real sessions. There is a naïve per-token rate limit on the paid transcribe
endpoint and a path-traversal guard on `/api/audio/:id`, but that is the extent
of the hardening.

---

## The transcription seam

One server function, two paths (`server/src/transcribe.ts`):

- **live** (the default) — `POST /api/transcribe` with an audio file → the server
  POSTs it to OpenAI Whisper (`whisper-1`) for an in-language transcript, then a
  second call for the English translation. **The API key lives only on the
  server** — that is the main reason the backend exists (a Vite client would
  bundle the key into every browser).
- **demo** (`?demo=1` on any route) — `POST /api/transcribe` with
  `demoUtteranceId` → returns a seeded Arabic transcript + English translation,
  **no network call**. A fallback if the venue wifi dies.

Either way the elder previews the transcript, picks a mood, sets visibility, then
`POST /api/checkins` saves it. `createdVia` records which path produced it, so
the demo can say truthfully which check-ins were live.

---

## The care-signal computation

`server/src/careSignal.ts`, all deterministic, no ML:

- **`weekStrip(...)`** — 11 columns (`WINDOW_OFFSETS` = −6…+4 days around
  `DEMO_DATE`). Each day: the elder's mood (via `visibleCheckin`, so a hidden
  note still yields its mood), `noteHidden`, and that day's caregiver + activity
  tags. Past days carry moods; upcoming days are schedule-only. A day with no
  check-in is `mood: null` — rendered as "—", never averaged.
- **`correlationCallout(...)`** — for each activity tag, compares its rate on
  `good` days vs `hard` days in the window. Emits **one** plain-language line
  (`"3 of her 4 good days this week included time in the garden."`) only if a tag
  clears `goodRate ≥ 0.6` **and** `hardRate ≤ 0.34` (or the mirror for a
  hard-day pattern). **Guarded**: nothing is emitted unless the window has ≥3
  `good` and ≥2 `hard` days (avoids divide-by-zero and small-sample noise). It
  states a co-occurrence and never asserts causation.
- **`shiftHeaderContext(...)`** — the caregiver's "before you start" line: the
  most recent prior check-in they're permitted to see, as mood + a short excerpt,
  or mood + "she left a note" when restricted.
- **Prayer-collision flag** — a pure check: an activity whose start is within
  30 minutes before a prayer time (hardcoded for `DEMO_DATE`, Dhuhr 12:50) is
  flagged inline on the coordinator's Upcoming card. *No seed shift currently
  starts in a prayer window — to demo it, edit one upcoming seed shift to a
  ~12:30 start.*

---

## Stack and why

| Part | Choice | Why |
|---|---|---|
| Frontend build | Vite | fastest cold start for a solo build |
| Frontend UI | React 19 + TypeScript | TS catches mistyped role/visibility strings; large hiring pool of examples |
| Styling | Tailwind (v3) | cheap focus states, no CSS architecture to design |
| Frontend state | Zustand (in the `app/` prototype) | tiny; the Replit build may use plain fetch + hooks |
| PWA | `vite-plugin-pwa`, precache only | installable on a judge's phone; no runtime caching (avoids stale code on stage) |
| Backend | plain Node + Express, run via `tsx` | **no build step, no native deps** → runs on Replit as-is |
| Persistence | `data.json` written on each mutation | survives a restart; nothing to provision |
| Transcription | OpenAI Whisper behind a server seam | good Arabic/French coverage; demo mode bypasses it |
| Charts | none | the week strip is a CSS table |
| ML | none | the callout is a threshold rule |

---

## Real vs. mocked (said out loud in the demo)

| Real | Mocked / seeded / roadmap |
|---|---|
| Whisper transcription + translation, **live and by default** — real mic → server → OpenAI | `?demo=1` is a spare tab with seeded clips if the venue wifi dies |
| The mood ribbon trends real check-in data; the loop (record → read → reschedule) is real | The ~6 days of history are seeded; audio files are 1-second **silent placeholders** until real clips are recorded |
| Consent enforced server-side; hidden words never leave the server | — |
| The correlation callout + the coordinator's suggested-move cards | A deterministic rate rule, **not** ML; asserts co-occurrence, never cause |
| Prayer-collision check (the function) | Prayer times hardcoded for `DEMO_DATE`; needs an upcoming shift near 12:30 to fire |
| Per-persona apps | Auth is `base64(userId)`, no password; one route per persona, auto-login, no switcher |

---

## Guardrails at a glance (`guardrails.md`)

- **No mood scoring.** Three labels the elder picks (`good`/`ok`/`hard`), never a
  number, average, index, or line chart.
- **No clinical logic.** No diagnoses, dosages, thresholds, triage, or advice.
- **Transcription, not interpretation.** Whisper writes down her words; it never
  summarises into "concerns" or extracts symptoms. Original audio always kept.
- **The client can't see a hidden note.** Enforcement is server-side.
- **Not a medical device.** Real elder data (incl. voice) is sensitive personal
  information under Quebec **Law 25**; sending it to a US processor is a
  cross-border transfer needing a privacy impact assessment. Demo data is
  fictional and marked as such on every screen.
- **No time-limited interactions.** Recording is never cut off by a timer.

---

## Known limitations (stated in the pitch, not hidden)

- **Voice-first excludes** non-verbal, aphasic, and advanced-dementia elders. It
  serves the large middle, not everyone.
- **Whisper's Arabic** skews to Modern Standard; a strong regional dialect
  transcribes worse. Mitigation: the original audio is always kept and
  replayable, so a person can verify.
- **"Now we know how she is" is an overclaim** if the elder minimises to the app
  the way she minimises on a phone call. The tool lowers the cost of telling the
  truth; it can't guarantee she will.
- **Languages** in the demo are `ar` / `fr` / `en`; real Montreal elder care
  spans many more.
- **Single elder, single role per person, no `Circle`** — see Deliberate
  shortcuts. Multi-elder or a coordinator-who-also-does-shifts needs a model
  change (`role: Role[]`, an `elderId` link).

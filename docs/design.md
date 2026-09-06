# Design

Build-time reference. Concept source: `../elderly-care-build-spec.md` (original, pre-pivot). Problem exploration: `../.claude/plans/im-still-not-convinced-wise-minsky.md`. Formal decision record: `../openspec/changes/elderly-care-mvp/design.md`.

**Current source of truth for building:** `../HANDOFF-FOR-REPLIT.md` (frontend) and `../server/README.md` (backend). This file is the architecture overview; those two carry the detail.

---

## The one-sentence architecture

The elder speaks her day → the backend transcribes it (real Whisper) and stores it → the coordinator app shows how her days are going and lets her reschedule → the schedule changes because of it. One API, one server-side consent filter, one deterministic correlation rule.

```
  4 route-apps (Replit frontend)                 server/ (Express + TS)
  /            Elder                              in-memory state + data.json
  /coordinator Coordinator      --- HTTP --->     |
  /caregiver   Caregiver         (Bearer token)   |-- visibleCheckin()  <- consent, server-side
  /family      Family                             |-- weekStrip / correlationCallout
                                                  |-- transcribe(): demo | live
                                                             |
                                                             v  (live only)
                                                     OpenAI Whisper  (key on the server)
```

No shared client store, no client-side consent logic. Every screen is a thin
view over API responses that are **already filtered for the caller**.

---

## Two codebases

| | |
|---|---|
| `server/` | Node + Express + TypeScript (run with `tsx`, no build). In-memory state, `data.json` persistence, no native deps → runs on Replit as-is. Owns the OpenAI key, consent enforcement, the care-signal computation. |
| Replit frontend | 4 route-apps (`/`, `/coordinator`, `/caregiver`, `/family`), each auto-signs-in as its seed user, no login screen, no persona switcher. Real `MediaRecorder` → `POST /api/transcribe`. |
| `app/` | The earlier single-app React prototype (Vite + Zustand). **Reference only** — lift logic (the `visibleCheckin` table, the strip/callout math, the primitives), not the layout. Not the thing being shipped. |

---

## Stack

| Layer | Choice | Note |
|---|---|---|
| Backend | Node + Express + TypeScript + `tsx` | no build step, no native deps (Replit-safe) |
| Backend state | in-memory + `data.json` | survives restarts; delete `data.json` to reseed |
| Transcription | OpenAI Whisper (`whisper-1`) via the backend | **live is the default**; `?demo=1` forces the seeded fallback |
| Frontend | Replit's choice (React recommended) | 4 routes; a real `api.ts` client |
| Charts / ML | none | mood ribbon is shaped markers; correlation is a rule |
| Auth | demo-grade (`base64url(userId)`, no password) | per-route auto-login; real auth is roadmap |

---

## transcribe — the one seam (server-side)

`server/src/transcribe.ts`. One place the frontend calls: `POST /api/transcribe`
with a `MediaRecorder` blob (multipart `audio`) or `demoUtteranceId`.

- **live** (default): the server POSTs the audio to Whisper for an in-language
  transcript, then a second call for the English translation. **The key never
  leaves the server** — this is why the backend exists. Set `OPENAI_API_KEY` in
  `server/.env` with a hard spending cap; delete it after the event.
- **demo** (`?demo=1` on any route): returns a seeded utterance + its placeholder
  audio, zero network. A safety net if the venue wifi dies mid-demo.

The demo is meant to run **live**. Real mic, real transcription, real network.

---

## visibleCheckin — consent, enforced on the server

`server/src/consent.ts`. Runs on every `GET /api/checkins`, `/api/care-signal`,
`/api/my-shift`. The wire never carries a transcript the caller may not read.

```
visibility: 'circle' | 'family' | 'coordinator' | 'mood-only'   (default: 'family')
visibleCheckin(c, viewer) -> 'full' | 'mood' | 'none'
```

- `circle` → `full` for anyone in the circle.
- `family` → `full` for `isFamily` viewers and the elder; `mood` otherwise.
- `coordinator` → `full` for the coordinator and the elder; `mood` otherwise.
- `mood-only` → `mood` for everyone except the elder.
- The elder always gets `full` for her own check-ins.
- `mood` / `none` still contribute the mood marker to the trend — a privacy
  choice never breaks the signal.

Note: the coordinator is `isFamily` in the seed, so he reads `family` notes. The
demo money-shot is the **elder** re-restricting a note → the **Family app** loses
the words, the mood marker stays.

---

## The coordinator app — insight, not a calendar

No day-columns grid, no modal editor. Top to bottom (full spec in HANDOFF §3):

1. **The read** — 2–3 plain sentences: good/steady/hard counts + the `callout`
   + (if computable) the hard-day pattern.
2. **Mood ribbon** — one horizontal band of shaped markers, one per day, today
   marked; tap a cell to expand who/what/her-words-if-permitted.
3. **Suggested moves** — 0–3 action cards the frontend computes from a written
   deterministic rule (HANDOFF §5): upcoming agency shifts missing the good-day
   activity → `[Give it to Amina]` / `[Add garden]`. Acting on one re-fetches
   `/api/care-signal`; the read + ribbon visibly recompute. That recompute is
   the loop closing on screen.
4. **Upcoming** — the next ~4 days as light cards with inline reassign / add-
   activity and an inline prayer-collision warning. No dialog.

---

## The correlation rule (server + the frontend's suggestion rule mirror it)

Over past days with a mood: per activity tag, `goodRate` = share of good days
with it, `hardRate` = share of hard days with it. Guard: need ≥3 good and ≥2 hard
days. Emit at most one callout where `goodRate ≥ 0.6` and `hardRate ≤ 0.34`,
tie-broken toward the "good day" phrasing. Never asserts cause. Server:
`server/src/careSignal.ts`. Frontend suggestion rule: HANDOFF §5.

---

## Prayer times

`server/src/seed.ts` `prayerTimes`, served by `GET /api/prayer-times` (hardcoded
for `DEMO_DATE`, behind a stable shape so a real source drops in later). The
frontend flags an upcoming shift that starts within 30 min before a prayer,
inline on the Upcoming card. Cultural context otherwise surfaces through the
elder's own words in a check-in, not a settings sheet.

---

## Accessibility

The elder app is voice-first — the headline decision. Plus: shape-and-label mood
markers (never colour alone), a single "Aa" sheet for text size (`--scale`
1/1.2/1.4) and high contrast (`:root[data-contrast="high"]`), no time-limited
interactions, 44px targets, AA contrast, layout survives `--scale: 1.4` + 200%
zoom. One screen-reader pass on the elder check-in flow, reported honestly.
Detail in `accessibility.md`.

---

## What not to build

A login screen, a persona switcher, a calendar grid, a settings toolbar,
charts/graph libraries, upload/attachments, timeline, assistant, escalation,
matching, notifications, **any mood score or number**, **any clinical logic**.
See `../openspec/changes/elderly-care-mvp/proposal.md` CUT list.

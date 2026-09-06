# Her Day

**The elder-care app that asks her how her day was — and moves the schedule based on the answer.**

_MuslimHacks 2026 · Challenge 01 (Elder care) · solo build, ~24h_

> ⚠️ **Demo project.** Every person and record in it is fictional. Authentication is
> demo-grade (shared password, forgeable tokens). Do not put real personal or health
> data into this app as it stands.

---

## Why

Elder care is measured by what goes wrong — falls, missed medications, ER visits,
complaints. A day with none of those counts as a good day, no matter how the elder
actually felt living it. The person receiving the care has no channel to put anything
*in*: she is monitored, scheduled, and talked about, but nothing is built to listen
to her. If she is Arabic-first, has cataracts and arthritis, and has never typed on a
phone, every existing care app locks her out on the first screen.

**Her Day makes the elder's own account of her day the signal her care runs on**, and
lets *her* control who hears each thing.

## What it does

- **Nightly voice check-in.** The elder taps one big button and speaks ~20s in her own
  language. OpenAI Whisper transcribes it and puts a translation beside it; the
  original recording is always kept. She picks one mood and chooses who may hear it.
- **The loop closes.** Her check-ins trend *next to the schedule* — which caregiver
  came, what they did, time spent outside. The coordinator schedules toward her good
  days. Remote family see "is she okay?" instead of an adherence percentage.
- **Consent enforced on the server.** A note she marks private is never sent to a
  hired caregiver's browser at all — not hidden with CSS, not sent.
- **Weekly care plan.** A routine template that expands into each day's checklist;
  timed task completion is visible to coordinator and family in real time.
- **Clinical files.** Consent-gated storage for discharge papers / prescriptions,
  with an upload scan that rejects corrupt or executable files. Display only — the app
  never interprets a document.
- **Built for the elder.** Arabic-first UI with full RTL, read-aloud (TTS) in her
  language, real text zoom, high contrast, and a pointer magnifier.

## Architecture

```
frontend/  React 19 + Vite + Tailwind v4        four role views over one typed API client
   |
   |  fetch (Bearer token)
   v
server/    Node + Express + TypeScript (tsx)     in-memory state + data.json persistence
   |                                             consent.ts  -> one visibility check, every read path
   |                                             plan.ts     -> weekly routine -> per-day rows
   |                                             scan.ts      -> upload safety check
   v
OpenAI     whisper-1 (transcribe + translate) · tts-1 (read-aloud, disk-cached)
```

- **No database.** State lives in memory and is mirrored to `server/data.json`.
- **No build step on the server.** `tsx` runs the TypeScript directly; no native deps.
- **Consent is a boundary, not a filter.** `visibleCheckin()` / `visibleFile()` run on
  every read; the wire never carries data the caller isn't allowed to see.

## Tech stack

| Area      | Tools |
|-----------|-------|
| Language  | TypeScript |
| Frontend  | React 19, Vite 7, Tailwind CSS v4, wouter, lucide-react |
| Backend   | Node.js, Express 4, tsx, multer |
| Voice     | OpenAI Whisper (`whisper-1`), OpenAI TTS (`tts-1`) |
| Storage   | In-memory + JSON file |
| i18n      | Custom dictionary, English + Arabic (RTL) |

## Running locally

Requires Node 20+ and an OpenAI API key.

### 1. Backend

```bash
cd server
npm install
# create server/.env:
#   OPENAI_API_KEY=sk-...
#   CORS_ORIGIN=http://localhost:5173   # optional; defaults to reflecting the request origin
npm start          # http://localhost:8787
```

### 2. Frontend

```bash
cd frontend
npm install
# frontend/.env already contains:
#   VITE_API_BASE=http://localhost:8787
npm run dev        # http://localhost:5173
```

Open **http://localhost:5173**.

### Demo personas

All share the password **`vivemdu212`**. The login page also has one-tap demo chips.
The demo runs on a pinned date (**2026-09-06**, a Sunday) with seeded history.

| Username        | Role        | Who |
|-----------------|-------------|-----|
| `elder-fatima`  | elder       | Fatima — Arabic UI, RTL |
| `coord-yusuf`   | coordinator | Yusuf — her son, organizes the care |
| `cg-amina`      | caregiver   | Amina — family caregiver |
| `cg-lea`        | caregiver   | Léa — hired agency caregiver (sees least) |
| `fam-mona`      | family      | Mona — remote family |

Open four tabs to run all four views at once — each tab holds its own session.

`POST /api/demo/reset` restores seeded state.

## Honest status

**Real:** voice recording, Whisper transcription + translation, TTS, server-side
consent enforcement, routine / care-plan system, timed task completion, file upload +
scan + consent gating, all CRUD.

**Demo-grade / not built:** real authentication, database, multi-elder tenancy,
notifications, onboarding/invite flow, deployment, automated test suite. Auth tokens
are `base64url(userId)` and forgeable. `data.json` is plaintext at rest. Audio is sent
to OpenAI in the US (a real deployment needs on-region processing + a privacy impact
assessment).

## Roadmap

1. **Two-way channel** — when a caregiver logs a concern or a hard-day pattern appears,
   the app asks the elder one spoken question that evening; her answer routes to the
   coordinator.
2. Real auth + Postgres; multi-tenant.
3. Mobile / installable client.
4. On-region speech processing (Quebec Law 25); native-speaker review of all copy;
   accessibility audit with real elders.

## Repository layout

```
frontend/   the React app (all four views)
server/     the Express API
docs/       design, data model, guardrails, technical overview, demo script, pitch
openspec/   the spec-driven change that defines the MVP
app/         earlier standalone prototype (reference only)
```

## License

Not licensed for reuse. Hackathon submission — fictional demo data only.

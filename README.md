# Amanah

**The elder-care app that asks her how her day was — and moves the schedule based on the answer.**

_Started at MuslimHacks 2026 (Challenge 01, Elder care) as a 24h solo hackathon build,
now becoming a real multi-tenant product._

> ⚠️ **Pre-release.** The database and API are real (Postgres + Row-Level Security,
> a proper multi-tenant schema, magic-link auth) but the frontend has not been
> rewired to them yet, and nothing is deployed. Do not put real personal or health
> data into this app as it stands.

---

## Why

Elder care is measured by what goes wrong — falls, missed medications, ER visits,
complaints. A day with none of those counts as a good day, no matter how the elder
actually felt living it. The person receiving the care has no channel to put anything
*in*: she is monitored, scheduled, and talked about, but nothing is built to listen
to her. If she is Arabic-first, has cataracts and arthritis, and has never typed on a
phone, every existing care app locks her out on the first screen.

**Amanah makes the elder's own account of her day the signal her care runs on**, and
lets *her* control who hears each thing. *Amanah* — something entrusted to your
safekeeping — is what a family's account of her day, and her trust in who hears it,
actually is.

## What it does

- **Nightly voice check-in.** The elder taps one big button and speaks ~20s in her own
  language. OpenAI Whisper transcribes it and puts a translation beside it; the
  original recording is always kept. She picks one mood and chooses who may hear it.
- **The loop closes.** Her check-ins trend *next to the schedule* — which caregiver
  came, what they did, time spent outside. The coordinator schedules toward her good
  days. Remote family see "is she okay?" instead of an adherence percentage.
- **Consent enforced at the database, not the app.** A note she marks private never
  reaches a hired caregiver's connection at all — the database itself refuses the
  row, regardless of what the API layer does or doesn't check.
- **Weekly care plan.** A routine template that expands into each day's checklist;
  editing a routine item never rewrites what past days already showed. Timed task
  completion is visible to coordinator and family in real time.
- **Multi-tenant from the schema up.** Any number of families, each with their own
  circle of coordinator / caregivers / family / elder, fully isolated from every
  other family's data — enforced by Postgres Row-Level Security, not application code.
- **Built for the elder.** Arabic-first UI with full RTL, read-aloud (TTS) in her
  language, real text zoom, high contrast, and a pointer magnifier *(frontend; not
  yet reconnected to the new backend — see Honest status)*.

## Architecture

```
frontend/  React 19 + Vite + Tailwind v4        four role views over one typed API client
   |                                             (currently targets the RETIRED
   |  fetch (Bearer token)                        single-tenant API — see below)
   v
server/    Node + Express + TypeScript (tsx)    magic-link JWT auth (Supabase)
   |                                             withUserTxn — every request runs as
   |                                             a real restricted Postgres role,
   |                                             claims bound, never interpolated
   v
supabase/  Postgres, RLS as the authorization boundary
   |         organizations -> circles -> circle_members / checkins / checkin_content /
   |         shifts / routine_items / completions / adhoc_tasks / invites
   v
OpenAI     whisper-1 (transcribe + translate) · tts-1 (read-aloud, disk-cached)
```

- **Real database.** Supabase-hosted Postgres, not in-memory state. Every tenant
  table has Row-Level Security **forced** (`FORCE ROW LEVEL SECURITY`) — the API's
  own connection role has no bypass.
- **RLS is the authorization boundary, not a filter the app applies on read.** A
  consent-tier check for a check-in's words/audio is a real child-table policy: a
  viewer who isn't permitted gets zero rows back from Postgres, not a nulled field.
- **Magic-link auth**, verified server-side against Supabase's JWKS/JWT secret —
  no passwords, no forgeable `base64url(userId)` tokens.
- **A 160+ test suite** exercises this against the real local stack: real RLS,
  real JWTs, real cross-tenant isolation checks — not mocks.

## Tech stack

| Area      | Tools |
|-----------|-------|
| Language  | TypeScript |
| Frontend  | React 19, Vite 7, Tailwind CSS v4, wouter, lucide-react |
| Backend   | Node.js, Express 4, tsx, multer, `pg`, `jose` |
| Database  | Postgres via Supabase, Row-Level Security |
| Auth      | Supabase magic-link, JWT verification (JWKS + HS256 fallback) |
| Voice     | OpenAI Whisper (`whisper-1`), OpenAI TTS (`tts-1`) |
| Testing   | Vitest, Supertest, against a real local Supabase stack |
| i18n      | Custom dictionary, English + Arabic (RTL) |

## Running locally

Requires Node 20+, Docker (for the local Supabase stack), the Supabase CLI
(`npx supabase`), and an OpenAI API key for the voice features.

### 1. Database

```bash
npx supabase start        # first run pulls the Postgres/Auth/Storage images
npx supabase db reset      # apply all migrations
```

### 2. Server (the real multi-tenant API)

```bash
cd server
npm install
cp .env.example .env      # fill in DATABASE_URL / SUPABASE_* — see .env.example
npm start                 # http://localhost:8787
npm run test:db           # the full suite against your local stack
```

### 3. Frontend

The frontend still targets the earlier single-tenant API shape and does **not**
currently work against the server above — reconnecting it is Part 1c of the
rebuild (see Roadmap). Until then, `cd frontend && npm install && npm run dev`
gets you the UI, but its login and data calls won't succeed against the current
server.

## Honest status

**Real, and tested (160+ tests against a live local stack):** multi-tenant Postgres
schema with Row-Level Security as the real authorization boundary; magic-link JWT
auth; onboarding, invites, check-ins (with server-enforced consent tiers), shifts,
weekly routine + adhoc tasks, care-signal view, text-to-speech — all as a real
Express API, not in-memory state.

**Not yet built:** the frontend isn't wired to any of the above (it still expects
the old single-tenant shape); file/audio storage is stubbed pending Supabase
Storage; nothing is deployed; no onboarding/invite emails have been tried against
a real mail provider yet.

## Roadmap

This rebuild is running as a staged plan (`docs/superpowers/plans/`):

1. ✅ **Part 1a** — multi-tenant Postgres schema + RLS.
2. ✅ **Part 1b** — the API layer described above.
3. **Part 1c** (next) — Supabase Storage for check-in audio and clinical files,
   rewiring the frontend to the real API, and a first deployment.
4. Two-way channel — when a caregiver logs a concern or a hard-day pattern appears,
   the app asks the elder one spoken question that evening; her answer routes to
   the coordinator.
5. On-region speech processing (Quebec Law 25); native-speaker review of all copy;
   accessibility audit with real elders.

## Repository layout

```
frontend/   the React app (all four views) — pending reconnection, see Part 1c
server/     the Express API
supabase/   Postgres migrations + local dev config
docs/       design, data model, guardrails, technical overview, demo script, pitch
openspec/   the spec-driven change that defined the original single-tenant MVP
app/        earlier standalone prototype (reference only)
```

## License

Not licensed for reuse. Started as a hackathon submission — fictional demo data only.

# Her Day — API server

Backend for the elder-care check-in loop. Plain Node + Express + TypeScript,
in-memory state with JSON-file persistence (`data.json`), no native deps →
runs on Replit as-is.

## Run

```
npm install
npm run dev               # http://localhost:8787 (tsx watch)
# or: npm start
```

`.env` already exists on this machine with a working `OPENAI_API_KEY` — the
server loads it itself (`src/loadEnv.ts`, no dependency). Startup prints
`live transcription ready`. Verified end to end: real audio → server → OpenAI
Whisper → transcript. **If you run this on Replit, set `OPENAI_API_KEY` there
too** (Replit Secrets), and `CORS_ORIGIN` to the frontend URL.

Without the key, `POST /api/transcribe` with real audio returns 502 and only the
`?demo=1` seeded path works.

Live recordings are also written to `audio/uploads/<id>.<ext>` so they survive a
restart. `data.json` persists check-ins/shift edits and **overrides `seed.ts`
while it exists** — delete it (or `POST /api/demo/reset`) to reseed.

## What it owns

- **The OpenAI key.** Live transcription is proxied here so the key never
  reaches the browser (this is why the backend exists). Still: set a spending
  cap and delete the key after the event.
- **Consent enforcement.** `src/consent.ts` `visibleCheckin()` runs on every
  read; the wire never carries a transcript the caller may not see. This is a
  real boundary, unlike the earlier client-only prototype.
- **The care-signal computation** (`src/careSignal.ts`) — week strip +
  deterministic, non-causal correlation callout (guarded: ≥3 good, ≥2 hard
  days).

## Endpoints

See `../HANDOFF-FOR-REPLIT.md` §2 for the full table. Quick check:

```
curl localhost:8787/api/health
```

## Auth

Demo only: `POST /api/auth/login {userId}` → `{ token }`, then
`Authorization: Bearer <token>`. Token is `base64url(userId)`, no password.
Replace before this is anything real.

## Demo helpers

- `POST /api/demo/reset` — restore seed data (bind to a hidden control in the UI
  for rehearsal).
- `data.json` is written on every mutation; delete it to force a fresh seed.

## Files

| file | role |
|---|---|
| `src/index.ts` | routes |
| `src/seed.ts` | fictional data — **keep in sync with `app/src/data/seed.ts`** |
| `src/db.ts` | in-memory state + JSON persistence |
| `src/consent.ts` | the one enforcement point |
| `src/careSignal.ts` | week strip + correlation + shift-header context |
| `src/transcribe.ts` | demo utterances + live Whisper proxy |
| `src/auth.ts` | demo token + role guards |
| `audio/*.wav` | 1-second **silent placeholders** — replace with real recordings |

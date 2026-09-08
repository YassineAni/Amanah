# Amanah — Multi-Tenant MVP: Design Spec

- **Date:** 2026-09-08
- **Status:** Draft for review
- **Supersedes:** the single-tenant hackathon build in `server/`

---

## 1. Context

Amanah began as a 24-hour hackathon build (MuslimHacks 2026): an elder-care
coordination app where the elder's nightly spoken check-in — transcribed by OpenAI
Whisper, in her own language — becomes a signal the care schedule is arranged
around. The hackathon build is single-tenant and in-memory: one hardcoded elder, a
pinned `DEMO_DATE`, seven shared-password logins, JSON-file persistence, forgeable
tokens.

This spec covers turning that into a **functional MVP** that can safely hold a
pilot family's real data and be shown to prospective agency customers.

### Why an MVP, not a full productionization

Demand is unproven — one qualitative signal so far (a medical student: "this
solves a big problem"). The MVP is the discovery vehicle: a real, working,
safe-enough product to put in front of pilot families and small Québec home-care
agencies, whose reactions decide whether to invest further. Scope is therefore
deliberately minimal — the smallest real thing, nothing extra.

---

## 2. Scope

### In

- Multi-tenant Postgres schema (Supabase): organizations → circles → members
- Row-Level Security on every tenant table as the real authorization boundary
- Supabase Auth (email/password + magic link)
- Onboarding: sign up → create circle → invite care team → optional elder invite
- The check-in loop end to end (record → real Whisper transcribe + translate →
  mood → consent tier → stored; playback via signed URL)
- Coordinator care-signal (check-ins beside the schedule + correlation callout)
- Care plan (weekly routine → daily tasks; caregiver marks done; family read-only;
  ad-hoc tasks)
- Shifts with visit check-in / check-out
- Clinical files (scan → Storage → signed-URL download, consent-gated)
- Circle switcher for multi-circle users (families with >1 elder; agency staff)
- Frontend wired to the new API + auth, deployed
- Focused RLS / consent test suite + domain unit tests in CI
- One deploy (Supabase + Fly.io API + static frontend), HTTPS, nightly backup
- EN + FR UI; language-agnostic voice input
- A seeded demo circle for prospect demos

### Out (Phase 2+)

- Billing / Stripe (pilots are free)
- Agency admin dashboards, cross-circle reporting, staff management
- The two-way-channel feature (caregiver concern → spoken question → coordinator)
- Refactoring `App.tsx` beyond what wiring requires
- Moving speech processing off OpenAI (add a disclosure; migrate later)
- Native-speaker review of French / non-English copy before wide release
- Per-location prayer times
- Notifications / email digests
- Full Law 25 privacy impact assessment (before wide launch, not pilot)
- Real-time updates (polling stays)

---

## 3. Architecture

**Approach:** keep the existing Express + TypeScript API; add Supabase for
Postgres, Auth, and Storage.

Rejected alternatives: Supabase-native with Edge Functions (rewrites the domain
logic into an unfamiliar runtime); a Next.js rebuild (also moves the frontend —
too much churn before a customer).

```
Browser (React 19 + Vite SPA)
  |  supabase-js: auth (JWT in localStorage)
  |  fetch: Authorization: Bearer <supabase jwt>  -->  Express API (Fly.io, yul)
  |                                                     |  verify JWT (Supabase JWKS)
  |                                                     |  pg pool as role app_authenticated
  |                                                     |    SET LOCAL request.jwt.claims  --> RLS applies
  |                                                     |  service_role pool (onboarding, invites, seed)
  |                                                     |  OpenAI Whisper / TTS
  v                                                     v
Supabase (ca-central-1): Postgres + Auth + Storage (private buckets: audio, files)
```

### RLS enforcement model

- The API's main DB pool connects as **`app_authenticated`** — least privilege: no
  `BYPASSRLS`; every tenant table has `FORCE ROW LEVEL SECURITY`.
- Each request runs its queries inside a transaction that first sets
  `request.jwt.claims` to the verified Supabase JWT claims. `auth.uid()` then
  drives every policy.
- If a code path forgets to set the claims, `auth.uid()` is null, every policy's
  `USING` clause is false, and queries return nothing. **Fails closed.**
- A separate **`service_role`** connection is used only where the caller is
  legitimately not yet a member of the target rows: creating an org + circle at
  onboarding, accepting an invite, generating signed URLs, and the demo seed.
  Never reachable from the browser.

### Expected implementation split (see the plan, not this spec, for detail)

1. **1a** — schema + enums + RLS policies + helper functions + the RLS/consent
   test harness.
2. **1b** — auth middleware, onboarding/invite endpoints, port every domain
   endpoint to SQL, port the domain modules with unit tests.
3. **1c** — Storage wiring, frontend auth + circle switcher + API client, deploy
   + CI.

---

## 4. Data model

Postgres. All PKs `uuid default gen_random_uuid()`. Every table has
`created_at timestamptz not null default now()`.

### Enums

```
org_kind            : family | agency
circle_role         : elder | coordinator | caregiver | family
mood               : good | ok | hard
checkin_visibility  : circle | family | coordinator | mood_only
file_visibility     : circle | family | coordinator
task_category       : medication | personal_care | meal | rest | activity | other
file_category       : discharge | prescription | lab | imaging | care_plan | other
```

### Tenancy tables

**`profiles`** — app mirror of `auth.users`, created by a trigger on
`auth.users` insert.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | = `auth.users.id` |
| `email` | citext not null | |
| `full_name` | text not null | from `raw_user_meta_data` |
| `ui_lang` | text not null default `'en'` | `en` \| `fr` |

**`organizations`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `kind` | org_kind not null default `'family'` | |
| `owner_user_id` | uuid not null → profiles(id) | the un-removable admin / biller |
| `is_demo` | boolean not null default false | |

**`circles`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations(id) on delete cascade | |
| `name` | text not null | defaults to the elder's name |
| `elder_user_id` | uuid → profiles(id) | **nullable**; set when the elder accepts an invite |
| `elder_name` | text not null | |
| `elder_lang` | text not null default `'ar'` | spoken language for Whisper (ISO-639-1 where possible) |
| `timezone` | text not null | IANA, e.g. `America/Toronto` |
| `archived_at` | timestamptz | care ended; row kept |

Constraint: `unique (elder_user_id) where elder_user_id is not null` — one elder =
one circle.

**`circle_members`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `circle_id` | uuid not null → circles(id) on delete cascade | |
| `user_id` | uuid not null → profiles(id) on delete cascade | |
| `role` | circle_role not null | |
| `is_family_member` | boolean not null default true | false = hired / agency staff |
| `invited_by` | uuid → profiles(id) | |
| `joined_at` | timestamptz not null default now() | |
| `removed_at` | timestamptz | soft remove; RLS ignores rows where not null |

Constraints: `unique (circle_id, user_id)`;
`unique (circle_id) where role = 'elder' and removed_at is null`.

**`invites`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `circle_id` | uuid not null → circles(id) on delete cascade | |
| `email` | citext not null | |
| `role` | circle_role not null | |
| `is_family_member` | boolean not null default true | |
| `token` | text not null unique | >= 32 bytes random, URL-safe |
| `invited_by` | uuid not null → profiles(id) | |
| `expires_at` | timestamptz not null | default `now() + interval '14 days'` |
| `accepted_at` | timestamptz | |

### Domain tables

Every domain table has `circle_id uuid not null references circles(id) on delete cascade`.

**`checkins`**

| column | type | notes |
|---|---|---|
| `occurred_on` | date not null | the day it is about; default today in circle tz |
| `mood` | mood not null | |
| `transcript` | text not null default `''` | |
| `translation` | text not null default `''` | |
| `spoken_lang` | text not null | |
| `audio_path` | text | Storage path in `audio` bucket; nullable |
| `visibility` | checkin_visibility not null default `'family'` | |
| `recorded_by` | uuid not null → profiles(id) | who pressed record |
| `is_proxy` | boolean not null default false | `recorded_by` is not the elder |
| `created_via` | text not null default `'live'` | `live` \| `demo` |

**`shifts`**

| column | type | notes |
|---|---|---|
| `starts_at` / `ends_at` | timestamptz not null | |
| `caregiver_id` | uuid → profiles(id) | nullable = unassigned |
| `purpose` | text not null default `''` | |
| `activity_tags` | text[] not null default `'{}'` | |
| `coordinator_note` | text | |
| `checked_in_at` / `checked_out_at` | timestamptz | visit verification |

**`routine_items`** — the standing weekly template

| column | type | notes |
|---|---|---|
| `title` | text not null | |
| `time_of_day` | time not null | |
| `category` | task_category not null default `'other'` | |
| `time_sensitive` | boolean not null default false | |
| `weekdays` | smallint[] not null | values 0–6, 0 = Sunday |
| `archived_at` | timestamptz | |

**`completions`** — one per (routine item, date), created only when done

| column | type | notes |
|---|---|---|
| `routine_item_id` | uuid not null → routine_items(id) on delete cascade | |
| `on_date` | date not null | |
| `done_at` | timestamptz not null default now() | |
| `done_by` | uuid not null → profiles(id) | |
| `note` | text | |

Constraint: `unique (routine_item_id, on_date)`.

**`adhoc_tasks`** — one-off, tied to a date

| column | type | notes |
|---|---|---|
| `on_date` | date not null | |
| `title` | text not null | |
| `time_of_day` | time not null | |
| `category` | task_category not null default `'other'` | |
| `time_sensitive` | boolean not null default false | |
| `added_by` | uuid not null → profiles(id) | |
| `done_at` | timestamptz | |
| `done_by` | uuid → profiles(id) | |
| `note` | text | |

**`clinical_files`**

| column | type | notes |
|---|---|---|
| `name` | text not null | |
| `category` | file_category not null default `'other'` | |
| `visibility` | file_visibility not null default `'coordinator'` | |
| `storage_path` | text not null | object path in `files` bucket |
| `mime` | text not null | |
| `size_bytes` | bigint not null | |
| `scanned_clean` | boolean not null default false | |
| `uploaded_by` | uuid not null → profiles(id) | |

### Removed vs. the hackathon model

- `Person.password`, `Person.username` → Supabase Auth
- global `Person.role` → `circle_members.role` (per circle)
- global `Person.isFamily` → `circle_members.is_family_member` (per circle)
- `Person.lang` → `profiles.ui_lang` + `circles.elder_lang`
- `DEMO_DATE`, `ELDER_ID` → deleted
- denormalized `doneByName` / `addedByName` / `uploadedByName` → joins to `profiles`
- `Checkin.audioId` (guessable route) → `audio_path` + signed URLs
- `ClinicalFile.seeded` → `organizations.is_demo`
- `prayer_times` → cut

---

## 5. Authorization (RLS)

### Postgres roles

- **`service_role`** — server only, `BYPASSRLS`. Onboarding, invite acceptance,
  signed-URL creation, demo seed.
- **`app_authenticated`** — the login role the request pool uses; no `BYPASSRLS`;
  RLS always applies. Assumes the Supabase `authenticated` role semantics via the
  set JWT claims.
- **`anon`** — no table grants at all. The invite-preview endpoint is a server
  route that uses `service_role` and returns a minimal shape.

### Helper functions (`SECURITY DEFINER`, schema `app`, pinned `search_path`)

- `app.is_member(circle uuid) -> boolean` — a `circle_members` row for
  `auth.uid()` in `circle` with `removed_at is null`
- `app.circle_role(circle uuid) -> circle_role` — that member's role, else null
- `app.is_family(circle uuid) -> boolean` — that member's `is_family_member`, else
  false
- `app.is_org_owner(circle uuid) -> boolean` — `auth.uid()` owns the circle's org

### Tenant isolation

Every domain table plus `circles`, `circle_members`, `invites`:

- `ENABLE` **and** `FORCE ROW LEVEL SECURITY`
- baseline `SELECT` policy `USING (app.is_member(circle_id))`; writes add role
  checks (below)
- `organizations`: `SELECT` / `UPDATE` `USING (owner_user_id = auth.uid())` (MVP;
  agency admins later)
- `profiles`: `SELECT` for `id = auth.uid()` OR any profile sharing a circle with
  `auth.uid()`; `UPDATE` own row only

### Check-in visibility

Base-table `SELECT` policy is just `app.is_member(circle_id)` — any circle member
may see that a check-in exists and its mood (the care-signal needs this). Column
redaction happens in a view **`checkins_visible`** (`security_invoker = true`, so
base-table RLS still applies) that the API reads instead of the base table:

`transcript`, `translation`, `audio_path` are set to `NULL` unless the viewer
gets **full**:

| `visibility` | full (words + audio) for |
|---|---|
| `circle` | any circle member |
| `family` | coordinator, any `is_family_member` member, or `recorded_by = auth.uid()` |
| `coordinator` | coordinator, or `recorded_by = auth.uid()` |
| `mood_only` | `recorded_by = auth.uid()` only |

Notes:
- When the elder records her own check-in she is `recorded_by`, so she always gets
  full on it via the `recorded_by` clause in every row.
- For a **proxy** check-in (`is_proxy = true`), the elder sees the words only if
  the tier admits her as a family member (`circle`, `family`) — not for
  `coordinator` or `mood_only` proxy entries. This is a deliberate, documented
  edge: those are a care worker's private observation; the elder still sees the
  entry exists, its mood, and who made it.

### File visibility

Encoded directly in the `SELECT` policy (row-level; bytes come via a signed URL
after a second check):

| `visibility` | visible to |
|---|---|
| `circle` | any circle member |
| `family` | coordinator OR `is_family_member` |
| `coordinator` | coordinator only — **hidden from the elder** |

Rationale for hiding `coordinator` files from the elder: files are third-party
documents *about* her (a capacity assessment, a hard-conversation record), not her
words. Standard healthcare carve-out. Her own check-ins remain fully
elder-controlled — that is where "she owns her record" lives.

### Writes

| Action | Allowed when |
|---|---|
| `checkins` INSERT | `app.circle_role(circle_id) in ('elder','coordinator','caregiver')`; `recorded_by = auth.uid()`; `is_proxy = (role <> 'elder')` |
| `checkins` UPDATE (visibility) / DELETE | non-proxy: `role = 'elder'`. proxy: elder OR `recorded_by = auth.uid()` OR coordinator |
| `shifts`, `routine_items` INSERT/UPDATE/DELETE | `role = 'coordinator'` |
| `shifts` UPDATE of `checked_in_at` / `checked_out_at` | assigned `caregiver_id = auth.uid()` OR coordinator |
| `completions`, `adhoc_tasks` INSERT/UPDATE | `role in ('coordinator','caregiver')` |
| `adhoc_tasks` DELETE | coordinator OR `added_by = auth.uid()` |
| `clinical_files` INSERT | `role = 'coordinator'` OR `app.is_family(circle_id)` |
| `clinical_files` UPDATE/DELETE | coordinator OR `uploaded_by = auth.uid()` |
| `circle_members` INSERT | `service_role` only (invite acceptance) |
| `circle_members` UPDATE of `removed_at` | coordinator; **cannot** remove the org owner or the last non-removed coordinator |
| `invites` INSERT | `role = 'coordinator'` |
| `circles`, `organizations` INSERT | `service_role` only (onboarding) |

---

## 6. Auth & onboarding

### Sign up

Supabase Auth, email/password + magic link, email confirmation on. Trigger
`handle_new_user()` inserts the `profiles` row.

### Create the first circle (new user, no org)

1. Form: elder name, spoken language, timezone (prefilled from `Intl`).
2. `POST /api/circles` → server (`service_role`): insert `organizations`
   (`kind='family'`, `owner_user_id = caller`), `circles`, `circle_members`
   (caller as `coordinator`, `is_family_member = true`).

### Invite the care team

`POST /api/circles/:cid/invites` (coordinator) → one `invites` row per email, each
with `role` + `is_family_member`; send an email containing
`/<app>/invite/<token>`.

### Accept an invite

- `GET /api/invites/:token` (public, server route, `service_role` lookup) →
  `{ circle_name, inviter_name, role, email }`, or `410` if expired / accepted.
- `POST /api/invites/:token/accept` (authenticated) → server (`service_role`):
  assert `auth.email() == invite.email`, `now() < expires_at`,
  `accepted_at is null`; insert `circle_members` (role, `is_family_member`); if
  `role = 'elder'`, set `circles.elder_user_id = auth.uid()`; set `accepted_at`.

### Second elder (multi-elder family)

"Add another person you care for" → same create-circle form → `POST /api/circles`
with the caller's existing `org_id` → new circle in that org. The circle switcher
(from `GET /api/me`) then lists both.

### Demo circle

`npm run seed:demo -- --owner-email <email>` (`service_role`): create
`organizations` (`kind='family'`, `is_demo = true`, name `"Demo — <x>"`), a circle
with a fake elder, ~6 historical `checkins` across the last week (varied
moods/visibility), a full `routine_items` set, past + upcoming `shifts`, and 3
`clinical_files` pointing at one bundled placeholder object. The frontend badges
`is_demo` circles.

---

## 7. API surface

Base path `/api`. Every non-public route requires
`Authorization: Bearer <supabase access token>`.

### Deleted

`POST /api/auth/login`, `GET /api/session` (→ Supabase Auth, client-side);
`POST /api/demo/reset`; `GET /api/audio/:id`; `GET /api/prayer-times`;
`GET /api/today`.

### Public

- `GET /api/health` → `{ ok: true }`
- `GET /api/invites/:token` → invite preview
- `POST /api/tts` → unchanged (text → speech, throttled 60 / 5 min / token; not
  circle data)

### Account / tenancy

- `GET /api/me` → `{ profile, circles: [{ id, name, role, is_demo }] }`
- `POST /api/circles` → body `{ elder_name, elder_lang, timezone, org_id? }`.
  `org_id` omitted → create a new `kind='family'` org owned by the caller, then the
  circle. `org_id` given → the caller must be that org's owner; the circle is added
  to it. → `{ circle }`
- `POST /api/circles/:cid/invites` → `{ invites: [...] }` (coordinator)
- `POST /api/invites/:token/accept` → `{ circle_id }`
- `DELETE /api/circles/:cid/members/:userId` → `204` (coordinator; guards)

### Circle-scoped — all under `/api/circles/:cid`

- `GET /members`
- `GET /checkins` — reads `checkins_visible`
- `POST /checkins/transcribe` — multipart `audio`, OR `{ demoUtteranceId }` (demo
  circles only) → `{ transcript, translation, spoken_lang, audio_path }`
- `POST /checkins` — `{ occurred_on?, mood, transcript, translation?, audio_path?,
  spoken_lang?, visibility? }`
- `PATCH /checkins/:id` — `{ visibility }`
- `DELETE /checkins/:id`
- `GET /checkins/:id/audio` — `{ url, expires_at }` signed URL (after the "full"
  check)
- `GET /care-signal` — `{ window: [...dates], days: StripDay[], callout }`; window
  is last 7 / next 4 days from today-in-tz
- `GET /shifts?from=&to=`
- `PATCH /shifts/:id` — assign / tags / note / check-in-out
- `GET /plan?date=` — `expandDay` → `PlanRow[]`
- `POST /plan/toggle` — `{ date, key, done, note? }`
- `POST /adhoc` — `{ date?, title, time, category?, time_sensitive?, note? }`
- `DELETE /adhoc/:id`
- `GET /routine`, `POST /routine`, `PATCH /routine/:id`, `DELETE /routine/:id`
  (coordinator)
- `GET /files`
- `POST /files` — multipart; scan → Storage → row
- `PATCH /files/:id`, `DELETE /files/:id`
- `GET /files/:id/url` — `{ url, expires_at }` short-TTL signed URL

### Cross-circle

- `GET /api/my-shifts` — the caller's upcoming shifts across every circle

---

## 8. Domain modules

Kept; logic unchanged. Inputs move from `db` arrays to SQL query results; each
gets unit tests.

- **`plan.ts`** — `expandDay(date, routineItems, completions, adhoc)`. Fix:
  `weekdayOf` computes in the circle's timezone, not server local.
- **`careSignal.ts`** — `weekStrip`, `correlationCallout`, `shiftHeaderContext`.
  Fixes: (a) the window is `now()` in the circle tz ± offsets, not `DEMO_DATE`;
  (b) `correlationCallout` only ever receives one circle's rows (the DB query is
  RLS-scoped) — assert this in a unit test.
- **`scan.ts`** — `scanFile(buf, mime)` unchanged; runs before the Storage upload.
- **`transcribe.ts`** — `demoTranscribe` (demo circles only) and `liveTranscribe`
  (OpenAI Whisper). `spokenLang` comes from `circles.elder_lang`. After
  transcription the audio is uploaded to `audio/<circle_id>/<uuid>.<ext>`;
  `audio_path` is returned.

---

## 9. Storage

Supabase Storage, two **private** buckets:

- `audio` — objects at `<circle_id>/<uuid>.<ext>`
- `files` — objects at `<circle_id>/<uuid>.<ext>`

The API is the only reader. Download flow: client calls `GET .../files/:id/url` →
API selects the row **as the user** (RLS visibility check) → if permitted, API
uses `service_role` to create a signed URL (TTL 120 s) → returns it. Uploads go
through the API (multipart → `scanFile` → `service_role` upload). Bucket policies
deny `authenticated` direct access.

---

## 10. Deployment & environments

| Piece | Choice |
|---|---|
| Database / Auth / Storage | Supabase, project region **`ca-central-1`** |
| API | Express container on **Fly.io**, primary region **`yul`**, 1 instance |
| Frontend | Vite static build on Vercel or Cloudflare Pages |
| Migrations | `supabase/migrations/*.sql`, applied by `supabase db push` in CI |

**Secrets** (Fly secrets / Supabase dashboard, never in the repo):
`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET`, `DATABASE_URL` (role `app_authenticated`),
`DATABASE_URL_ADMIN` (role `service_role` / `postgres`).

**Frontend env:** `VITE_API_BASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Environments:** `local` (`supabase start` + `tsx watch` + `vite`), `prod`. No
staging for the MVP.

**CI (GitHub Actions):**

- PR: install, typecheck, lint, `supabase start`, run migrations, run the full
  test suite.
- Push to `main`: `supabase db push` → deploy API (`flyctl deploy`) → build +
  deploy frontend.

---

## 11. Testing

### RLS / consent — table-driven (the core safety proof)

Fixture: 2 orgs, 3 circles (2 in org A, 1 in org B), a `profiles` row for every
`role × is_family_member` combination, seeded `checkins` (one per `visibility`)
and `clinical_files` (one per `visibility`).

For every `(viewer, resource, expected)` cell in the two matrices (§5): open a
client with **that user's real JWT**, query, assert row visibility and column
redaction. Generated from one declarative table so the matrix and the test cannot
drift.

### Attack cases (explicit)

- Cross-circle: an org-A member querying an org-B circle's rows → 0 rows.
- No JWT / expired JWT / JWT for a removed member → 0 rows.
- `GET /checkins/:id/audio` for a `mood_only` check-in as a hired caregiver → 403,
  no URL.
- A signed URL fetched after its TTL → rejected by Supabase.
- Invite: expired token, already-accepted token, wrong email → rejected.
- `correlationCallout` fed a multi-circle result set in a unit test → aggregates
  only the target circle.
- Removing the last coordinator / the org owner → rejected.

### Domain unit tests

- `expandDay`: weekday selection across timezones (circle in `America/Toronto`
  vs a UTC date boundary), completion merge, ad-hoc merge, sort order.
- `correlationCallout`: the `good >= 3 && hard >= 2` guard, each candidate branch,
  tie-break, empty result.
- `weekStrip`: mood / `noteHidden` per visibility, shift grouping.
- `scanFile`: each rejection branch (empty, EICAR, MZ/ELF, magic-byte mismatch,
  truncated PDF, script-in-text) + a passing case per mime.
- `weekdayOf` in the circle timezone.

### Integration (happy path)

Onboarding → create circle → invite → accept → record a proxy check-in →
coordinator sees it beside the schedule → toggle a routine task → the family
read-only view reflects it.

CI runs all of the above against a throwaway local Supabase on every PR.

---

## 12. Data protection posture (MVP)

- TLS everywhere (managed); Postgres encryption at rest (Supabase default).
- Nightly `pg_dump` to a storage bucket (the free tier has no automated backups).
- Signup: a consent checkbox + a one-page privacy notice (what is collected, that
  audio is sent to OpenAI in the US, how to delete).
- Delete path: `DELETE` a circle → cascade removes all its rows; the same handler
  deletes the Storage objects under that `circle_id`.
- Audit log: out of scope for the MVP (`created_at` + a `*_by` column on every row
  is the minimum trail).
- Full Law 25 privacy impact assessment + a data-processing agreement with OpenAI
  (or moving speech in-region): **required before onboarding a paying agency**,
  not before pilot families who have consented.

---

## 13. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Tenancy = **organization → circles → one elder per circle** | Superset of the family case (family = org with one circle, org UI hidden); no migration when selling to agencies. One extra table. |
| D2 | A person is **one account**; role is per-circle via `circle_members` | The same login can be coordinator for one elder, family for another. |
| D3 | Elder = `circles.elder_user_id` FK **+** an `elder` membership row; FK nullable | DB-guaranteed one elder per circle; circle usable before the elder has (or ever gets) an account. |
| D4 | **Multiple coordinators** allowed, as peers; the org has one un-removable `owner` | Families share the load; no single point of failure. |
| D5 | `is_family_member` is **per-membership**, not per-person | Someone is hired staff in one circle, a daughter in another. |
| D6 | **RLS is the real authorization boundary**; API shaping is the second layer | The product's whole claim is enforced consent; "the DB won't return it" beats "our code filters it" for a security review. |
| D7 | **Proxy check-ins allowed** — coordinator/caregiver only, always labelled, elder retains control | Safety net for elders who cannot use a phone; not a surveillance channel. |
| D8 | `coordinator` file visibility **excludes the elder** | Files are third-party documents about her, not her words; standard healthcare carve-out. Check-ins stay fully elder-controlled. |
| D9 | UI in **EN + FR**; voice input **language-agnostic**; Arabic UI + RTL dropped for the MVP | Removes RTL work and the native-review dependency; French is needed for Québec. Whisper translates to English only for now. |
| D10 | Region **`ca-central-1`** / Fly `yul` | Law 25 data residency; a permanent choice. |
| D11 | Keep Express + add Supabase (Approach 1) | Least churn; domain logic stays testable in TS; shortest path to a pilot. |

---

## 14. Known limitations (carried forward)

- Voice-first excludes fully non-verbal / advanced-dementia elders (proxy
  check-ins partly mitigate).
- Whisper Arabic accuracy skews to Modern Standard Arabic; strong dialects
  transcribe worse — the original audio is always kept and replayable.
- No real-time; the frontend polls.
- Single API instance; no horizontal scaling in the MVP.
- French UI copy and non-English voice-language labels are unreviewed by native
  speakers.
- Demand is unvalidated — this MVP exists to test it.

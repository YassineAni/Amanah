# Amanah — Multi-Tenant MVP: Design Spec

- **Date:** 2026-09-08
- **Status:** Draft for review — revision 2 (post-review)
- **Supersedes:** the single-tenant hackathon build in `server/`
- **Review:** `2026-09-08-amanah-multi-tenant-mvp-review.md` (10 critical + 14 should-fix findings, all folded in here)

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
deliberately minimal — the smallest real thing that still closes the loop. The
three reviews of revision 1 put the original scope at 6–8 weeks solo; revision 2
cuts it roughly in half (see D16).

---

## 2. Scope

### In

- Multi-tenant Postgres schema (Supabase): organizations → circles → members
- Row-Level Security on every tenant table as the real authorization boundary,
  with the direct-PostgREST path closed (D13)
- Supabase Auth — **magic link only** (D17)
- Onboarding: sign up → accept privacy notice → create circle (with a
  coordinator-authority attestation) → invite care team → optional elder invite
- The check-in loop end to end (record → real Whisper transcribe + translate →
  mood → consent tier → stored; playback via signed URL). Words + audio live in a
  separate RLS-protected table (D12)
- Coordinator care-signal — check-ins shown beside the schedule strip (no
  automated correlation callout; that's Phase 2)
- Care plan (weekly routine → daily tasks; caregiver marks done; family read-only;
  ad-hoc tasks)
- Shifts — assign a caregiver + visit check-in / check-out (thin; no correlation)
- Frontend wired to the new API + auth, deployed — **visuals unchanged**, wiring
  map delivered first (see §13 constraint)
- Focused RLS / consent / write-matrix test suite + domain unit tests in CI
- One deploy (Supabase + Fly.io API + static frontend), HTTPS, nightly backup of
  Postgres **and** the audio bucket, with a restore test
- **EN UI only**; language-agnostic voice input
- A seeded demo circle for prospect demos
- **A lightweight pre-pilot privacy assessment** — a hard gate before any real
  elder data enters the system (D19)

### Out (Phase 2+)

- **Clinical file storage** (upload / scan / Storage / signed-URL download /
  consent tier) — pilots share documents out of band
- **The automated correlation callout** — the coordinator reads the pattern from
  the strip
- **The circle-switcher UI** for multi-circle users — the schema stays
  future-proof (D1), the switcher waits
- **Password auth** — magic link only for the MVP
- **French UI** — needed before a Québec *agency*, not before a pilot *family*
- Billing / Stripe (pilots are free)
- Agency admin dashboards, cross-circle reporting, staff management
- The two-way-channel feature (caregiver concern → spoken question → coordinator)
- Refactoring `App.tsx` beyond what wiring requires
- Moving speech processing off OpenAI (disclose now; migrate later)
- Per-location prayer times
- Notifications / email digests
- The full formal Law 25 privacy impact assessment (the lightweight assessment
  above is the pilot gate; the formal PIA is a pre-wide-launch item)
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
  |  supabase-js: auth (magic-link JWT in localStorage)
  |  fetch: Authorization: Bearer <supabase jwt>  -->  Express API (Fly.io, yyz)
  |                                                     |  verify JWT (Supabase JWKS)
  |                                                     |  withUserTxn(): pg pool as app_authenticated,
  |                                                     |    one BEGIN..COMMIT, set_config(claims,$1,true)
  |                                                     |    --> every RLS policy (TO app_authenticated) applies
  |                                                     |  service_role pool (onboarding, invite accept,
  |                                                     |    signed-URL creation, demo seed) — never from browser
  |                                                     |  OpenAI Whisper / TTS
  v                                                     v
Supabase (ca-central-1): Postgres + Auth + Storage (1 private bucket: audio)
```

### RLS enforcement model (the security core — specified exactly)

**Connection.** `DATABASE_URL` for the request pool is a **direct connection
(port 5432) or a session-pinned pool — never the transaction pooler (6543)**. A
transaction pooler can hand a mid-transaction connection to another session and
break the `SET LOCAL` guarantee below.

**The one way to query as a user.** All user-scoped queries go through a single
mandatory wrapper:

```
withUserTxn(verifiedClaims, async (client) => {
  // BEGIN;
  // SELECT set_config('request.jwt.claims', $1, true);   -- $1 BOUND, never interpolated
  // ... the handler's queries ...
  // COMMIT;   (ROLLBACK on throw)
});
// on release: client runs DISCARD ALL
```

- `$1` is a **bound parameter**. The claims JSON carries user-controlled signup
  metadata (`name`, `email`); it must never be string-interpolated into SQL.
- `set_config(..., true)` = `SET LOCAL` semantics — the GUC is scoped to the
  transaction. `DISCARD ALL` on connection release is belt-and-braces against a
  leaked GUC surviving onto the next request's connection.
- If a code path skips the wrapper, `request.jwt.claims` is unset, `auth.uid()`
  is null, every policy's `USING` clause is false, queries return nothing.
  **Fails closed.**

**Roles.**

- **`app_authenticated`** — the login role the request pool uses. No `BYPASSRLS`.
  **Every RLS policy in this schema is written `TO app_authenticated`** — never
  the stock Supabase `TO authenticated`. The generated Supabase `authenticated` /
  `anon` roles and their auto-policies are not used.
- **`service_role`** — `BYPASSRLS`, server only. Onboarding, invite acceptance,
  signed-URL creation, demo seed, the audio-orphan sweeper. Never reachable from
  the browser.
- **`anon` / `authenticated`** — `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
  anon, authenticated;` (and on sequences, functions). PostgREST's exposed-schema
  list is pinned to an empty/internal schema. **The browser's Supabase JWT can
  reach data only through the Express API.** A test asserts the anon key + a user
  JWT against `/rest/v1/*` returns 0 rows / 401 (D13).

**Threat-model boundary (accepted for the MVP).** RLS defends against API *logic*
bugs — a forgotten filter, a new endpoint, a bad join. It does **not** defend
against process compromise: the Express host holds both the `app_authenticated`
and `service_role` pools, so an RCE or SSRF there is game-over regardless of RLS.
Hardening that (split services, per-request `service_role` scoping) is Phase 2.

### Expected implementation split (see the plan, not this spec, for detail)

1. **1a** — schema + enums + RLS policies + helper functions (owned correctly,
   D14) + immutability/guard triggers + the RLS/consent/write-matrix test harness
   + the direct-PostgREST lockdown.
2. **1b** — JWKS verify + `withUserTxn`, onboarding/invite endpoints, port every
   domain endpoint to SQL, port the domain modules with unit tests.
3. **1c** — audio Storage wiring, frontend magic-link auth + API client + wiring
   map, deploy + CI. (No clinical files, no circle-switcher UI.)

---

## 4. Data model

Postgres. All PKs `uuid default gen_random_uuid()`. Every table has
`created_at timestamptz not null default now()`. Mutable tables also carry
`updated_at timestamptz not null default now()` (touched by a trigger) — cheap
help for the polling frontend.

### Enums

```
org_kind            : family | agency
circle_role         : elder | coordinator | caregiver | family
mood               : good | ok | hard
checkin_visibility  : circle | family | coordinator | mood_only
task_category       : medication | personal_care | meal | rest | activity | other
activity_tag        : companionship | mobility | outing | meal_prep | hygiene | medical | household | other
```

`file_visibility` and `file_category` are dropped with clinical files.

### Tenancy tables

**`profiles`** — app mirror of `auth.users`, created by a trigger on
`auth.users` insert.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | = `auth.users.id` |
| `email` | citext not null | |
| `full_name` | text not null | trigger sets `left(coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''), split_part(email,'@',1)), 120)` — never null, bounded, so magic-link signup with no metadata cannot 500 |
| `ui_lang` | text not null default `'en'` | `check (ui_lang in ('en','fr'))` — value kept for Phase 2; UI is EN-only |
| `tos_accepted_at` | timestamptz | set when the privacy notice is accepted |
| `privacy_notice_version` | text | e.g. `'2026-09-08'` |

**`organizations`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | |
| `kind` | org_kind not null default `'family'` | |
| `owner_user_id` | uuid not null → profiles(id) `on delete restrict` | the un-removable admin / biller |
| `is_demo` | boolean not null default false | |

**`circles`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null → organizations(id) on delete cascade | |
| `name` | text not null | defaults to the elder's name |
| `elder_user_id` | uuid → profiles(id) `on delete set null` | **nullable**; set when the elder accepts an invite |
| `elder_name` | text not null | |
| `elder_lang` | text not null default `'ar'` | spoken language for Whisper (ISO-639-1 where possible); per-check-in override allowed |
| `timezone` | text not null | IANA, e.g. `America/Toronto`; validated server-side against a known set on write |
| `archived_at` | timestamptz | care ended / consent withdrawn; row kept |

Constraints: `unique (elder_user_id) where elder_user_id is not null` — one elder =
one circle. A trigger asserts `circles.elder_user_id` and the `circle_members`
`elder` row stay consistent.

**`circle_members`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `circle_id` | uuid not null → circles(id) on delete cascade | |
| `user_id` | uuid not null → profiles(id) on delete cascade | |
| `role` | circle_role not null | |
| `is_family_member` | boolean not null default true | false = hired / agency staff |
| `invited_by` | uuid → profiles(id) `on delete set null` | |
| `joined_at` | timestamptz not null default now() | |
| `removed_at` | timestamptz | soft remove; RLS ignores rows where not null |

Constraints: `unique (circle_id, user_id) where removed_at is null` (partial — a
soft-removed member can be re-invited); `unique (circle_id) where role = 'elder'
and removed_at is null`.

**`invites`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `circle_id` | uuid not null → circles(id) on delete cascade | |
| `email` | citext not null | stored `lower(trim(...))`; format-validated on insert |
| `role` | circle_role not null | |
| `is_family_member` | boolean not null default true | |
| `token` | text not null unique | >= 32 bytes random, URL-safe |
| `invited_by` | uuid not null → profiles(id) `on delete restrict` | |
| `expires_at` | timestamptz not null | default `now() + interval '14 days'` |
| `accepted_at` | timestamptz | |

Constraint: `unique (circle_id, email) where accepted_at is null` — one email
can't accumulate pending invites to the same circle.

### Domain tables

Every domain table has `circle_id uuid not null references circles(id) on delete cascade`.

**`checkins`** — existence + mood + tier; **any circle member may read** (the
care-signal strip and `GET /today` need this).

| column | type | notes |
|---|---|---|
| `occurred_on` | date not null | the day it is about; written as "today" in the circle tz |
| `mood` | mood not null | |
| `spoken_lang` | text not null | from `circles.elder_lang` unless the client overrode it at transcribe time |
| `visibility` | checkin_visibility not null default `'family'` | |
| `recorded_by` | uuid not null → profiles(id) `on delete restrict` | who pressed record; **immutable** |
| `is_proxy` | boolean not null default false | `recorded_by` is not the elder |
| `created_via` | text not null default `'live'` | `check (created_via in ('live','demo'))` |

**`checkin_content`** — the sensitive columns, **RLS-tier-protected** (D12). 1:1
with `checkins`.

| column | type | notes |
|---|---|---|
| `checkin_id` | uuid pk → checkins(id) on delete cascade | |
| `circle_id` | uuid not null → circles(id) on delete cascade | **immutable** |
| `visibility` | checkin_visibility not null | **denormalized, immutable** |
| `recorded_by` | uuid not null → profiles(id) | **denormalized, immutable** |
| `is_proxy` | boolean not null | **denormalized, immutable** |
| `transcript` | text not null default `''` | |
| `translation` | text not null default `''` | |
| `audio_path` | text | object path in the `audio` bucket; `check (audio_path is null or audio_path like circle_id::text || '/%')` |

The four denormalized columns (`circle_id`, `visibility`, `recorded_by`,
`is_proxy`) are copied from the parent `checkins` row at insert by a trigger and
frozen thereafter. A `PATCH /checkins/:id` that changes `visibility` updates both
rows in one statement pair. This keeps the tier `SELECT` policy self-contained —
it never subqueries `checkins` and so never evaluates a second table's RLS per
row.

**`shifts`**

| column | type | notes |
|---|---|---|
| `starts_at` / `ends_at` | timestamptz not null | `check (ends_at > starts_at)` |
| `caregiver_id` | uuid → profiles(id) `on delete set null` | nullable = unassigned |
| `purpose` | text not null default `''` | |
| `activity_tags` | activity_tag[] not null default `'{}'` | enum array — no free-text typos |
| `coordinator_note` | text | |
| `checked_in_at` / `checked_out_at` | timestamptz | `check (checked_out_at is null or checked_in_at is not null)` |

**`routine_items`** — the standing weekly template

| column | type | notes |
|---|---|---|
| `id` | uuid pk | also `unique (id, circle_id)` so children can compose-FK |
| `title` | text not null | |
| `time_of_day` | time not null | |
| `category` | task_category not null default `'other'` | |
| `time_sensitive` | boolean not null default false | |
| `weekdays` | smallint[] not null | `check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[] and array_length(weekdays,1) between 1 and 7)`; 0 = Sunday |
| `effective_from` | date not null default (current_date) | editing an item after this date should archive + re-create, not rewrite history |
| `archived_at` | timestamptz | effective-to |

**`completions`** — one per (routine item, date), created only when done

| column | type | notes |
|---|---|---|
| `routine_item_id` | uuid not null | |
| `circle_id` | uuid not null | **composite FK** `(routine_item_id, circle_id) references routine_items(id, circle_id)` — the item must belong to this circle |
| `on_date` | date not null | written as "today" in the circle tz |
| `done_at` | timestamptz not null default now() | |
| `done_by` | uuid not null → profiles(id) `on delete restrict` | **immutable** |
| `note` | text | |

Constraint: `unique (routine_item_id, on_date)`.

**`adhoc_tasks`** — one-off, tied to a date

| column | type | notes |
|---|---|---|
| `on_date` | date not null | circle-tz "today" |
| `title` | text not null | |
| `time_of_day` | time not null | |
| `category` | task_category not null default `'other'` | |
| `time_sensitive` | boolean not null default false | |
| `added_by` | uuid not null → profiles(id) `on delete restrict` | **immutable** |
| `done_at` | timestamptz | |
| `done_by` | uuid → profiles(id) `on delete set null` | |
| `note` | text | |

### Indexes

- `circle_members (user_id, circle_id) where removed_at is null` — **load-bearing**;
  every RLS evaluation calls `app.is_member`.
- `circle_id` on every domain table (Postgres does not auto-index FK columns).
- `checkins (circle_id, occurred_on)`, `shifts (circle_id, starts_at)`,
  `completions (circle_id, on_date)`, `adhoc_tasks (circle_id, on_date)`.
- `invites (email)`, `invites (token)` (unique already).
- `checkin_content (circle_id)`.

### Person-level deletion

A profile is never hard-deleted while it owns an org or is `recorded_by` /
`done_by` / `added_by` / `invited_by` anywhere (`on delete restrict`). "Delete me"
= soft-remove every membership, null the nullable authored refs
(`elder_user_id`, `caregiver_id`, `adhoc.done_by`), reassign or retain the
`restrict` refs under the org owner, then delete the `auth.users` row. The privacy
notice describes this.

### Removed vs. the hackathon model

- `Person.password`, `Person.username` → Supabase Auth (magic link)
- global `Person.role` → `circle_members.role` (per circle)
- global `Person.isFamily` → `circle_members.is_family_member` (per circle)
- `Person.lang` → `profiles.ui_lang` + `circles.elder_lang`
- `DEMO_DATE`, `ELDER_ID` → deleted
- denormalized `doneByName` / `addedByName` → joins to `profiles`
- `Checkin.audioId` (guessable route) → `checkin_content.audio_path` + signed URLs
- `Checkin.transcript/translation/audioId` → moved to `checkin_content` (RLS tier)
- `ClinicalFile*`, `prayer_times` → cut

---

## 5. Authorization (RLS)

### Postgres roles

See §3. Summary: `service_role` (BYPASSRLS, server only); `app_authenticated`
(request pool, every policy `TO app_authenticated`); `anon` / `authenticated` (all
grants revoked, PostgREST schema pinned empty).

### Helper functions (schema `app`, `SECURITY DEFINER`, `STABLE`, pinned `search_path`)

**Owned by a role with `BYPASSRLS`** (D14). Under `FORCE ROW LEVEL SECURITY` the
table owner has no RLS exemption, so `circle_members`' own policy calling
`app.is_member` (which reads `circle_members`) would recurse or return zero rows
if the helper were owned by an ordinary role. A test asserts a policy-triggered
call does not recurse.

- `app.is_member(circle uuid) -> boolean` — a `circle_members` row for
  `auth.uid()` in `circle` with `removed_at is null`
- `app.circle_role(circle uuid) -> circle_role` — that member's role, else null
- `app.is_family(circle uuid) -> boolean` — that member's `is_family_member`, else
  false
- `app.is_org_owner(circle uuid) -> boolean` — `auth.uid()` owns the circle's org

### Tenant isolation — two shapes of table

Every domain table plus `circles`, `circle_members`, `invites`: `ENABLE` **and**
`FORCE ROW LEVEL SECURITY`.

**Tables without a visibility model** (`checkins`, `shifts`, `routine_items`,
`completions`, `adhoc_tasks`, `circles`, `circle_members`, `invites`): a single
`SELECT` policy `USING (app.is_member(circle_id))`.

**Tables with a visibility model** (`checkin_content`): **exactly one** `SELECT`
policy that is the full combined condition (`membership AND tier`). No separate
baseline `is_member` policy — two `PERMISSIVE` policies would OR together and the
tier check would restrict nothing.

- `organizations`: `SELECT USING (owner_user_id = auth.uid() OR EXISTS (SELECT 1
  FROM circles c WHERE c.org_id = organizations.id AND app.is_member(c.id)))` —
  so invited staff can read `is_demo` for `/api/me`. `UPDATE` owner only.
- `profiles`: `SELECT` for `id = auth.uid()` OR any profile sharing a circle with
  `auth.uid()`; `UPDATE` own row only.

**RLS is membership-scoped, not circle-scoped.** A user in two circles passes
`app.is_member` for both. Every `/api/circles/:cid` handler **must additionally
filter `circle_id = :cid`** in its SQL. RLS is the safety net against a *missing*
filter reaching another tenant; the explicit filter is what scopes a request to
the circle in its URL.

### Check-in content visibility — the one `checkin_content` SELECT policy

A row is visible (words + audio) when the member is in the circle **and**:

| `visibility` | additionally |
|---|---|
| `circle` | (nothing — any member) |
| `family` | `app.circle_role(circle_id) = 'coordinator'` OR `app.is_family(circle_id)` OR `recorded_by = auth.uid()` |
| `coordinator` | `app.circle_role(circle_id) = 'coordinator'` OR `recorded_by = auth.uid()` |
| `mood_only` | `recorded_by = auth.uid()` only |

(`recorded_by`, `visibility`, `is_proxy` are the denormalized immutable columns on
`checkin_content` itself — the policy never touches `checkins`.)

Notes:
- The elder is `recorded_by` on her own check-ins, so she always gets the full
  row via the `recorded_by` clause.
- For a **proxy** check-in (`is_proxy = true`) at `coordinator` or `mood_only`
  visibility, the elder sees the `checkins` row (it exists, its mood, who made it)
  but **no `checkin_content` row**. Deliberate, documented: those are a care
  worker's private observation. Her own check-ins stay fully elder-controlled.

### Writes

| Action | Allowed when |
|---|---|
| `checkins` INSERT (+ its `checkin_content` row, same txn) | `app.circle_role(circle_id) in ('elder','coordinator','caregiver')`; `recorded_by = auth.uid()`; `is_proxy = (role <> 'elder')` |
| `checkins` UPDATE (`visibility` only) / DELETE | non-proxy: `role = 'elder'`. proxy: elder OR `recorded_by = auth.uid()` OR coordinator. The elder may change `visibility` **only on a check-in whose content she can see** (recorded by her, or the current tier admits her) |
| `shifts` INSERT / DELETE / UPDATE (assign, tags, note) | `role = 'coordinator'` |
| `shifts` UPDATE of `checked_in_at` / `checked_out_at` (those columns only — trigger-enforced) | assigned `caregiver_id = auth.uid()` OR coordinator |
| `routine_items` INSERT/UPDATE/DELETE | `role = 'coordinator'` |
| `completions`, `adhoc_tasks` INSERT/UPDATE | `role in ('coordinator','caregiver')` |
| `adhoc_tasks` DELETE | coordinator OR `added_by = auth.uid()` |
| `circle_members` INSERT | `service_role` only (invite acceptance) |
| `circle_members` UPDATE (`removed_at` only — trigger-enforced) | coordinator; trigger also blocks removing the org owner or the last non-removed coordinator (see below) |
| `invites` INSERT | `role = 'coordinator'` |
| `circles`, `organizations` INSERT | `service_role` only (onboarding) |

### Column immutability & integrity (triggers, not RLS predicates — D15)

`WITH CHECK` gates which *rows* you may write, not which *columns* changed.
`BEFORE UPDATE` triggers enforce:

- `circle_id` and every `*_by` attribution column (`recorded_by`, `done_by`,
  `added_by`, `invited_by`, `owner_user_id`) are immutable after insert.
- A `caregiver`-role update to `shifts` may touch only `{checked_in_at,
  checked_out_at}`.
- An update to `circle_members` by a coordinator may touch only `{removed_at}`
  (no `role` escalation, no `is_family_member` flip).
- `checkin_content`'s denormalized `circle_id` / `visibility` / `recorded_by` /
  `is_proxy` are copied from `checkins` at insert and frozen; a `PATCH` of
  `visibility` writes both rows together.
- `circles.elder_user_id` and the `circle_members` `elder` row stay consistent.

### Last-coordinator / owner guard (trigger + row lock — C9)

"Cannot remove the last coordinator or the org owner" is an aggregate over the
table being mutated, and two concurrent self-removals under Read Committed both
see `count = 2` and both commit → zero coordinators. The `BEFORE UPDATE` trigger
on `circle_members` takes `SELECT ... FOR UPDATE` on the `circles` row (serializing
removals for that circle), then counts remaining non-removed coordinators and
checks the target is not `organizations.owner_user_id`'s membership. The
invite-accept handler and this trigger are the only writers of `circle_members`.

### Closing the direct-PostgREST path (D13)

Part of migration 1a: `REVOKE ALL ON ALL TABLES / SEQUENCES / FUNCTIONS IN SCHEMA
public FROM anon, authenticated;`, set the PostgREST `db-schemas` config to an
empty internal schema, confirm no policy is written `TO authenticated` /
`TO public`. Test: anon key + a real user JWT against `/rest/v1/checkins`,
`/rest/v1/checkin_content`, `/rest/v1/circle_members` → 0 rows or 401.

---

## 6. Auth & onboarding

### Sign up

Supabase Auth, **magic link only** (email OTP), email confirmation on. Trigger
`handle_new_user()` inserts the `profiles` row with the safe `full_name`
expression from §4. No password flow exists.

### Accept the privacy notice

On first sign-in (before circle creation), the user accepts a one-page privacy
notice; the API records `profiles.tos_accepted_at` + `privacy_notice_version`.
Blocked from creating or joining a circle until accepted.

### Create the first circle (new user, no org)

1. Form: elder name, spoken language, timezone (prefilled from `Intl`), and a
   required **attestation** checkbox — "I am authorised to coordinate this
   person's care."
2. `POST /api/circles` → server (`service_role`), **one transaction**: insert
   `organizations` (`kind='family'`, `owner_user_id = caller`), `circles`,
   `circle_members` (caller as `coordinator`, `is_family_member = true`). The
   handler validates `timezone` against a known IANA set and enforces a per-user
   org cap (10). Partial failure rolls back — no orphan circle.

### Invite the care team

`POST /api/circles/:cid/invites` (coordinator) → one `invites` row per email
(`lower(trim())`, format-validated), each with `role` + `is_family_member`.
Delivery via `supabase.auth.admin.inviteUserByEmail()` with `circle_id`, `role`,
`is_family_member` in user metadata (D18) — the magic-link email doubles as the
invite. `unique (circle_id, email) where accepted_at is null` prevents duplicates.

### Accept an invite

- `GET /api/invites/:token` (public, server route, `service_role` lookup, IP-
  throttled) → `{ circle_name, inviter_name, role }` — **no email in the
  response** — or `410` if expired / accepted.
- `POST /api/invites/:token/accept` (authenticated) → server (`service_role`), one
  transaction:
  1. Compare-and-swap: `UPDATE invites SET accepted_at = now() WHERE token = $1
     AND accepted_at IS NULL AND now() < expires_at RETURNING *`. No row → `410`.
  2. Assert `auth.email() = invite.email`.
  3. Upsert `circle_members`: if a soft-removed row exists for
     `(circle_id, user_id)`, clear `removed_at` and set the new `role` /
     `is_family_member`; else insert. Already an active member → `409`.
  4. If `role = 'elder'`: the elder slot must be free (`unique` partial index) —
     set `circles.elder_user_id = auth.uid()`; slot filled → `409`.

### Second elder (multi-elder family)

"Add another person you care for" → same create-circle form → `POST /api/circles`
with the caller's existing `org_id` (ownership checked as the user) → new circle
in that org. `GET /api/me` then returns both circles. (The switcher UI itself is
Phase 2; the API and schema support it now.)

### Demo circle

`npm run seed:demo -- --owner-email <email>` (`service_role`): create
`organizations` (`kind='family'`, `is_demo = true`, name `"Demo — <x>"`), a circle
with a fake elder, ~6 historical `checkins` + `checkin_content` across the last
week (varied moods / visibility), a full `routine_items` set, past + upcoming
`shifts`. No clinical files. The frontend badges `is_demo` circles.

---

## 7. API surface

Base path `/api`. Every non-public route requires
`Authorization: Bearer <supabase access token>` and runs its DB work inside
`withUserTxn`.

### Deleted

`POST /api/auth/login`, `GET /api/session` (→ Supabase Auth, client-side);
`POST /api/demo/reset`; `GET /api/audio/:id`; `GET /api/prayer-times`; the old
single-tenant `GET /api/today` (replaced by the circle-scoped one below); all
`/api/files*` routes (clinical files cut).

### Public

- `GET /api/health` → `{ ok: true }`
- `GET /api/invites/:token` → `{ circle_name, inviter_name, role }` (no email;
  IP-throttled)

### Account / tenancy

- `GET /api/me` → `{ profile, circles: [{ id, name, role, is_demo }] }`
- `POST /api/circles` → body `{ elder_name, elder_lang, timezone, attestation:true,
  org_id? }`. `org_id` omitted → new `kind='family'` org owned by the caller, then
  the circle (one txn). `org_id` given → the caller must own that org (checked as
  the user); the circle is added to it. → `{ circle }`
- `POST /api/circles/:cid/invites` → `{ invites: [...] }` (coordinator)
- `POST /api/invites/:token/accept` → `{ circle_id }`
- `DELETE /api/circles/:cid/members/:userId` → `204` (coordinator; guard trigger)
- `DELETE /api/circles/:cid` → `204` (coordinator who is also the org owner) —
  cascades all circle rows **and** deletes every `audio/<cid>/*` Storage object;
  covered by an integration test

### Circle-scoped — all under `/api/circles/:cid` (each also filters `circle_id = :cid`)

- `GET /members`
- `GET /demo/utterances` → `[{ id, label }]` — demo circles only (verified against
  `circles.is_demo`); the seeded utterance list the demo check-in flow picks from
- `GET /today` → `{ today, has_checkin, last_mood }` — the cheap elder-home query
- `GET /checkins` — `checkins` LEFT JOIN `checkin_content` (words/audio present
  only where the tier policy admits the viewer)
- `POST /checkins/transcribe` — multipart `audio` OR `{ demoUtteranceId }` (demo
  circles only — verified against `circles.is_demo`); optional `{ spoken_lang }`
  override. The server uploads the audio to `audio/<cid>/staging/<uuid>.<ext>` and
  returns `{ transcript, translation, spoken_lang, staging_path }`. The client
  never composes a path itself.
- `POST /checkins` — `{ occurred_on?, mood, transcript, translation?, spoken_lang?,
  visibility?, staging_path? }`. Server asserts `staging_path` begins with
  `<cid>/staging/` and the object exists, **moves** it to
  `audio/<cid>/<uuid>.<ext>`, then writes `checkins` + `checkin_content`
  (`audio_path` = the moved path) in one transaction.
- `PATCH /checkins/:id` — `{ visibility }`
- `DELETE /checkins/:id`
- `GET /checkins/:id/audio` — selects the `checkin_content` row **as the user**
  (tier policy); if present → `service_role` signed URL (TTL 120 s) →
  `{ url, expires_at }`; else `403`
- `GET /care-signal` — `{ window: [...dates], days: StripDay[] }`; window is last 7
  / next 4 days from today-in-circle-tz. **No `callout` field** (Phase 2)
- `GET /shifts?from=&to=`
- `POST /shifts` — `{ starts_at, ends_at, caregiver_id?, purpose?, activity_tags?,
  coordinator_note? }` (coordinator)
- `PATCH /shifts/:id` — assign / tags / note (coordinator) or check-in-out
  (assigned caregiver; columns trigger-restricted)
- `DELETE /shifts/:id` (coordinator)
- `GET /plan?date=` — `expandDay` → `PlanRow[]`
- `POST /plan/toggle` — `{ date, key, done, note? }`
- `POST /adhoc` — `{ date?, title, time, category?, time_sensitive?, note? }`
- `DELETE /adhoc/:id`
- `GET /routine`, `POST /routine`, `PATCH /routine/:id`, `DELETE /routine/:id`
  (coordinator)

### Cross-circle

- `GET /api/my-shifts` — the caller's upcoming shifts across every circle

### `POST /api/tts`

Moved **out of Public** — now requires `Authorization`, throttled **per user id**
(60 / 5 min), with a hard OpenAI spend cap. Not circle data.

---

## 8. Domain modules

Kept; logic mostly unchanged. Inputs move from `db` arrays to SQL results; each
gets unit tests.

- **`plan.ts`** — `expandDay(date, routineItems, completions, adhoc)`.
  `weekdayOf(dateString)` stays a **pure** function — the weekday of a bare
  `YYYY-MM-DD` is timezone-independent and the current
  `new Date(date + 'T00:00:00').getDay()` is correct. `expandDay` now also filters
  routine items to those with `effective_from <= date` and no `archived_at` before
  `date`. Sort gets a stable tie-break for equal `time_of_day`.
- **`careSignal.ts`** — `weekStrip`, `shiftHeaderContext`. `correlationCallout` is
  **removed for the MVP** (Phase 2). The window is `now()` in the circle tz ±
  offsets, never `DEMO_DATE`. `weekStrip` takes `circleId` and asserts every row
  belongs to it (defence in depth behind the endpoint's explicit filter).
- **`scan.ts`** — **removed** (clinical files cut).
- **`transcribe.ts`** — `demoTranscribe` (demo circles only; verifies
  `circles.is_demo`) and `liveTranscribe` (OpenAI Whisper). `spokenLang` comes
  from `circles.elder_lang` unless the client passed an override. The audio lands
  in `audio/<circle_id>/staging/<uuid>.<ext>`; `POST /checkins` promotes it to
  `audio/<circle_id>/<uuid>.<ext>` when the check-in is saved. A staging object
  that is never promoted is deleted by the nightly sweeper (§9).

### Timezone test targets

`expandDay` / the care-signal window: a circle in `America/Toronto` against a UTC
date-boundary time, plus the DST transition days (2 Nov 2025, 8 Mar 2026).
`on_date` writes use circle-tz "today".

---

## 9. Storage

Supabase Storage, **one private bucket**: `audio`, objects at
`<circle_id>/<uuid>.<ext>`. (The `files` bucket is dropped with clinical files.)

- The API is the only reader. `authenticated` / `anon` are denied direct bucket
  access.
- `POST /checkins/transcribe` uploads to `audio/<cid>/staging/<uuid>`; `POST
  /checkins` moves it to `audio/<cid>/<uuid>` on save. Both go through the API as
  `service_role`.
- Download: client calls `GET .../checkins/:id/audio` → API selects the
  `checkin_content` row as the user (tier policy) → if permitted, API uses
  `service_role` to create a signed URL (TTL 120 s).
- **Orphan sweeper** (nightly, `service_role`): delete any `audio/<cid>/**` object
  — staging or promoted — older than 24 h with no matching
  `checkin_content.audio_path`.
- Circle deletion (`DELETE /api/circles/:cid`) explicitly deletes every
  `audio/<cid>/*` object — the row cascade does not touch Storage.

---

## 10. Deployment & environments

| Piece | Choice |
|---|---|
| Database / Auth / Storage | Supabase, project region **`ca-central-1`** |
| API | Express container on **Fly.io**, primary region **`yyz`** (`yul` deprecated on Fly post-spec — see D10 note) |
| Frontend | Vite static build on Vercel or Cloudflare Pages |
| Migrations | `supabase/migrations/*.sql`, applied by `supabase db push` in CI |

**Secrets** (Fly secrets / Supabase dashboard, never in the repo):
`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` (or JWKS URL), `DATABASE_URL` (role `app_authenticated`,
**direct connection / port 5432 or a session-pinned pool — not the transaction
pooler**), `DATABASE_URL_ADMIN` (role `service_role`).

**Frontend env:** `VITE_API_BASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Environments:** `local` (`supabase start` + `tsx watch` + `vite`), `prod`. No
staging for the MVP.

**Backups:** a nightly job — **owned by a GitHub Actions scheduled workflow** —
runs `pg_dump` **and** mirrors the `audio` bucket to a backup location. A
quarterly (and pre-pilot) **restore test** rebuilds a throwaway project from the
dump + bucket copy and runs the integration suite against it.

**CI (GitHub Actions):**

- PR: install, typecheck, lint, `supabase start`, run migrations (twice, to prove
  idempotency on a non-empty DB), run the full test suite.
- Push to `main`: `supabase db push` → deploy API (`flyctl deploy`) → build +
  deploy frontend.

---

## 11. Testing

### RLS / consent / write matrix — table-driven (the core safety proof)

Fixture: 2 orgs, 3 circles (2 in org A, 1 in org B), a `profiles` row for every
`role × is_family_member` combination, **plus one profile that is an active member
of two circles in different orgs**, seeded `checkins` + `checkin_content` (one per
`visibility`, some proxy). No clinical files.

For every `(viewer, resource, expected)` cell in the visibility matrix (§5): open
a client with **that user's real JWT**, query through `withUserTxn`, assert row
visibility and that `checkin_content` returns **zero rows** when the viewer is not
"full". Generated from one declarative table so the matrix and the test cannot
drift.

### Attack cases (explicit)

- **Cross-circle:** an org-A member querying an org-B circle's rows → 0 rows.
- **Multi-circle viewer:** the two-circle profile hits `/api/circles/:A/care-signal`
  → sees only circle A's rows (proves the explicit `circle_id` filter, since RLS
  alone would admit B).
- **No / expired / removed-member JWT** → 0 rows everywhere.
- **No claims set:** a raw `app_authenticated` connection with no
  `request.jwt.claims` → `SELECT *` on every table → 0 rows (proves fail-closed).
- **Base-table-direct:** `SELECT transcript FROM checkins` as `app_authenticated`
  → column does not exist / no grant; `SELECT * FROM checkin_content` for a
  `mood_only` row the caller did not record → 0 rows.
- **Claims leakage:** request A (circle 1, user X) then request B (circle 2, user
  Y) on a 1-connection pool → B sees no stale `auth.uid()` / rows.
- **PostgREST direct:** anon key + a user JWT against `/rest/v1/*` → 0 rows / 401.
- **`service_role` handler authz:** `POST /api/circles` with someone else's
  `org_id` → 403; `POST /checkins` for a circle the caller is not in → 403.
- **`staging_path` tampering:** `POST /checkins` with a `staging_path` pointing at
  another circle (or outside `staging/`) → rejected.
- **`GET /checkins/:id/audio`** for a `mood_only` check-in as a hired caregiver →
  403, no URL. A signed URL fetched after its TTL → rejected by Supabase.
- **Invite:** expired token, already-accepted token, wrong email → rejected;
  concurrent double-accept → exactly one membership; re-invite of a soft-removed
  member → succeeds and clears `removed_at`.
- **Last coordinator / org owner removal** → rejected, including two concurrent
  self-removals.
- **`handle_new_user()`** with absent / empty / 10 000-char / `<script>`
  `full_name` metadata → row created, `full_name` safe and ≤ 120 chars.
- **Write matrix (~15 rows):** caregiver INSERTs a `routine_item` → denied; family
  toggles a completion → denied; a non-elder UPDATEs a non-proxy check-in's
  visibility → denied; an unassigned caregiver sets `checked_in_at` → denied; a
  caregiver UPDATE that also changes `shifts.caregiver_id` → denied; a
  `removed_at` UPDATE that also changes `role` → denied.

### Domain unit tests

- `expandDay`: weekday selection across timezones (circle in `America/Toronto`
  vs a UTC date boundary) + the two DST transition days; `effective_from` /
  `archived_at` windowing; completion merge; ad-hoc merge; stable sort order.
- `weekStrip`: mood / `noteHidden` per visibility; shift grouping; single-circle
  assertion.
- `weekdayOf` — pure, timezone-independent.

### Integration (happy path)

Sign up → accept privacy notice → create circle (with attestation) → invite →
accept → record a **proxy** check-in → coordinator sees it beside the schedule
strip → toggle a routine task → the family read-only view reflects it → delete the
circle → its audio objects are gone.

### Performance

`EXPLAIN` on a policy-heavy query (`GET /care-signal`) confirms the
`circle_members (user_id, circle_id) where removed_at is null` index is used, not
a seq scan.

CI runs all of the above against a throwaway local Supabase on every PR.

---

## 12. Data protection posture (MVP)

- TLS everywhere (managed); Postgres encryption at rest (Supabase default).
- **Region.** DB / Auth / Storage in `ca-central-1` is a deliberate
  data-minimisation choice — **not** a Law 25 compliance claim. Law 25 does not
  mandate residency; it requires a documented assessment of any transfer of
  personal information outside Québec.
- **The OpenAI transfer.** Whisper / TTS audio and text are sent to OpenAI in the
  US. This is disclosed in the privacy notice, and a **written transfer
  assessment** must exist **before any real elder data — pilot included**.
- **Pre-pilot privacy assessment (hard gate — D19).** Before onboarding any real
  family: a one-page data inventory (what, where, retention); the OpenAI transfer
  assessment above; the consent + coordinator-authority attestation flow; the
  deletion path (person-level and circle-level); privacy notice v1, versioned in
  `profiles.privacy_notice_version`. Days of work, not weeks — but it blocks the
  pilot.
- **Consent capture.** `profiles.tos_accepted_at` + `privacy_notice_version` on
  sign-in; the coordinator attestation on circle creation.
- **Consent withdrawal.** `archived_at` on the circle → transcription stops, the
  circle goes read-only; full delete on request via `DELETE /api/circles/:cid`.
- **Delete path.** `DELETE` a circle → row cascade + explicit Storage cleanup for
  `audio/<cid>/*`. Person-level deletion per §4.
- **Backups.** Nightly `pg_dump` + `audio` bucket mirror (GitHub Actions), with a
  restore test (§10).
- **Audit log:** out of scope for the MVP — `created_at` + the immutable `*_by`
  column on every row is the minimum trail.
- The **full formal Law 25 PIA** and a signed data-processing agreement with
  OpenAI (or moving speech in-region) remain required before a paying agency.

---

## 13. Frontend wiring (constraint, not a design)

The existing Vite frontend (currently "Her Day", pre-rebrand) is **connected to
the new API and Supabase magic-link auth without changing its visuals**. Per the
standing instruction: a **wiring map is delivered first** — every screen, the call
it makes today, the call it will make, the auth/circle context it needs — and
**no visual change is made without asking**. The rebrand (name, logo, favicon,
"OK" mood label) is tracked separately and is not part of this spec.

What the wiring touches, at minimum: a magic-link sign-in screen; `api.ts` gains a
bearer-token header and a `:cid` path segment; a single active-circle context
(from `GET /api/me`, first circle for now — no switcher UI); the check-in,
care-signal, plan, and shifts screens repoint to `/api/circles/:cid/*`; the elder
home uses `GET /today`.

---

## 14. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Tenancy = **organization → circles → one elder per circle** | Superset of the family case (family = org with one circle, org UI hidden); no migration when selling to agencies. One extra table. |
| D2 | A person is **one account**; role is per-circle via `circle_members` | The same login can be coordinator for one elder, family for another. |
| D3 | Elder = `circles.elder_user_id` FK **+** an `elder` membership row; FK nullable | DB-guaranteed one elder per circle; circle usable before the elder has (or ever gets) an account. A trigger keeps the two in sync. |
| D4 | **Multiple coordinators** allowed, as peers; the org has one un-removable `owner` | Families share the load; no single point of failure. |
| D5 | `is_family_member` is **per-membership**, not per-person | Someone is hired staff in one circle, a daughter in another. |
| D6 | **RLS is the real authorization boundary**; API shaping is the second layer | The product's whole claim is enforced consent; "the DB won't return it" beats "our code filters it" for a security review. |
| D7 | **Proxy check-ins allowed** — coordinator/caregiver only, always labelled, elder retains control | Safety net for elders who cannot use a phone; not a surveillance channel. |
| D8 | `coordinator` check-in visibility **excludes the elder** for a proxy entry's words | A care worker's private observation. The elder still sees the entry, its mood, and who made it; her own check-ins stay fully elder-controlled. A pilot family can widen the tier. |
| D9 | UI in **EN only** for the MVP; voice input **language-agnostic**; Arabic + French UI deferred | Removes RTL work, the French translation work, and the native-review dependency. Whisper translates to English only for now. |
| D10 | Region **`ca-central-1`** / Fly `yul` — as **data minimisation**, not a compliance claim | Keeps personal data in-country by default; the OpenAI transfer is handled separately (§12). A permanent infra choice. **Superseded 2026-09-13:** `yul` deprecated on Fly (confirmed via a real `fly deploy` refusal — cannot provision new resources there); moved to `yyz` (Toronto). Same data-minimisation intent, still Canada, still close to Supabase `ca-central-1` — the decision's substance is unchanged, only the specific city. |
| D11 | Keep Express + add Supabase (Approach 1) | Least churn; domain logic stays testable in TS; shortest path to a pilot. |
| D12 | Check-in words/audio live in a separate **`checkin_content`** table with its own RLS tier policy — not a redaction view | A `security_invoker` view is bypassable via the base table; a `SECURITY DEFINER` view relocates the tenant check into a view definition. A child table with real RLS returns **zero rows** to a non-permitted viewer. |
| D13 | Every RLS policy targets **`app_authenticated`**; `anon` / `authenticated` have all grants revoked and PostgREST's schema is pinned empty | The Express API becomes the only path to data; a stray `TO authenticated` policy can't quietly open a direct PostgREST hole. |
| D14 | RLS helper functions are **owned by a `BYPASSRLS` role** and `STABLE` | Under `FORCE ROW LEVEL SECURITY` an ordinary-owned `SECURITY DEFINER` helper that reads `circle_members` recurses or returns zero rows. |
| D15 | The last-coordinator/owner guard and all column-immutability rules are **triggers**, not RLS predicates | Aggregates-under-concurrency and column-diff checks aren't expressible in `USING` / `WITH CHECK`. |
| D16 | **MVP scope cut** — clinical files, the automated correlation callout, the circle-switcher UI, password auth, and French UI are deferred to Phase 2; the multi-elder schema stays | Revision-1 reviews put the original scope at 6–8 weeks solo against one demand signal. Clinical files carry the most compliance weight and are not the differentiator. |
| D17 | Auth is **magic-link only** for the MVP | No password-reset flow, no credential-handling surface. |
| D18 | Invite email delivery uses **`supabase.auth.admin.inviteUserByEmail()`** | No new email-provider dependency; the magic-link email doubles as the invite. |
| D19 | A **lightweight pre-pilot privacy assessment** is a hard gate before any real elder data — pilot included | "Pilots are free" is not a Law 25 basis; obligations attach to processing personal info and to cross-border transfer. |
| D20 | The request pool uses a **direct / session-pinned connection** (not the transaction pooler); `withUserTxn` is the only way to acquire it | `SET LOCAL request.jwt.claims` is only safe on a connection that isn't swapped mid-transaction and is `DISCARD ALL`'d on release. |

---

## 15. Known limitations (carried forward)

- Voice-first excludes fully non-verbal / advanced-dementia elders (proxy
  check-ins partly mitigate).
- Whisper Arabic accuracy skews to Modern Standard Arabic; strong dialects
  transcribe worse — the original audio is always kept and replayable.
- **No clinical file storage** in the MVP — pilots share documents out of band.
- **No correlation callout** — the coordinator reads the pattern from the strip.
- **Single auth method** (magic link) — no account recovery beyond "request
  another link".
- **Process compromise of the Express host bypasses RLS** (both DB pools live
  there). Accepted MVP boundary; hardening is Phase 2.
- No real-time; the frontend polls.
- Single API instance; no horizontal scaling in the MVP.
- Demand is unvalidated — this MVP exists to test it.

---

## 16. Pilot acceptance criteria

The pilot is a test, so name what it is testing. A pilot circle "worked" if, over
~4 weeks:

- **The elder checks in.** Nightly check-in completion rate ≥ 50% of days (proxy
  or self).
- **The coordinator reads the signal.** The care-signal screen is opened on ≥ 60%
  of days a check-in exists.
- **Care actually changes.** At least one concrete schedule / task change the
  coordinator attributes to a check-in pattern.
- **Consent holds up.** No family member reports seeing something they should not
  have; no request to widen or narrow a tier goes unmet by the model.
- **Nothing breaks the trust.** Zero incidents of cross-circle data exposure;
  every deletion request honoured within 7 days.

These are instrumented with `created_at` timestamps and a lightweight event log
(screen-open pings) — not a full analytics stack.

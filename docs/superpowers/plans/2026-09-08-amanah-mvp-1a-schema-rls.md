# Amanah MVP — Part 1a: Schema, RLS & Test Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the multi-tenant Postgres schema on Supabase with Row-Level Security as the real authorization boundary, proven by a table-driven test suite that a non-permitted viewer gets **zero rows**.

**Architecture:** Supabase local stack (Postgres + GoTrue + PostgREST + Storage) driven by SQL migrations in `supabase/migrations/`. RLS policies target a dedicated `app_authenticated` login role; the API (built in Part 1b) will connect as that role and set `request.jwt.claims` per request. Tests connect with raw `pg` clients — one with no claims (proves fail-closed), one that sets claims itself (the consent matrix), and one `fetch` against local PostgREST with a minted JWT (proves the browser cannot bypass the API).

**Tech Stack:** PostgreSQL 15 (Supabase), Supabase CLI, TypeScript, Vitest, `pg`, `jose`. No ORM — hand-written SQL migrations.

**Spec:** `docs/superpowers/specs/2026-09-08-amanah-multi-tenant-mvp-design.md` (revision 2). This plan implements §4 (data model), §5 (authorization), and the schema-facing parts of §11 (testing). Read the spec alongside this plan.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Every RLS policy is written `TO app_authenticated`** — never `TO authenticated` or `TO public`. A policy on the wrong role silently does nothing under `FORCE ROW LEVEL SECURITY` (§3, §5, D13).
- **Every tenant table gets `ENABLE ROW LEVEL SECURITY` *and* `FORCE ROW LEVEL SECURITY`** (§5).
- **RLS helper functions are `SECURITY DEFINER`, owned by `postgres` (which has `BYPASSRLS`), `STABLE`, with `SET search_path = ''`** and all identifiers schema-qualified (§5, D14).
- **`anon` and `authenticated` have every grant revoked in `public`; PostgREST's exposed schema is pinned away from `public`** (§3, D13).
- **The last-coordinator / owner guard and all column-immutability rules are triggers, not RLS predicates** (§5, D15).
- Postgres: all PKs `uuid default gen_random_uuid()`. Every table has `created_at timestamptz not null default now()`; mutable tables also `updated_at timestamptz not null default now()` (§4).
- Enums are exactly: `org_kind(family|agency)`, `circle_role(elder|coordinator|caregiver|family)`, `mood(good|ok|hard)`, `checkin_visibility(circle|family|coordinator|mood_only)`, `task_category(medication|personal_care|meal|rest|activity|other)`, `activity_tag(companionship|mobility|outing|meal_prep|hygiene|medical|household|other)` (§4). `file_visibility` / `file_category` are **not** created (clinical files are out — D16).
- Node 24, `"type": "module"` in `server/package.json`. Migration timestamps use the prefix `20260908NNNNNN`.
- Local Supabase ports are remapped `543xx` → `541xx` (this Windows host reserves `54312–54411` via `winnat`/Hyper-V dynamic exclusion; `541xx` is free). `supabase/config.toml`: `[api].port = 54121`, `[db].port = 54122`, `[db].shadow_port = 54120`, `[studio].port = 54123`, `[inbucket].port = 54124`, `[analytics].port = 54127`. Local Supabase DB URL: `postgresql://postgres:postgres@127.0.0.1:54122/postgres`. Local API URL: `http://127.0.0.1:54121`. Parts 1b/1c use the same remapped ports.

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/config.toml` | Local stack config; **exposed schema pinned** so PostgREST does not serve `public` |
| `supabase/migrations/20260908000001_roles_extensions_enums.sql` | Extensions, enums, `app` schema, `app_authenticated` role |
| `supabase/migrations/20260908000002_tenancy_core.sql` | `profiles`, `organizations`, `circles` |
| `supabase/migrations/20260908000003_membership_invites.sql` | `circle_members`, `invites` |
| `supabase/migrations/20260908000004_triggers_profiles_touch.sql` | `handle_new_user()`, `set_updated_at()` |
| `supabase/migrations/20260908000005_domain_checkins_shifts.sql` | `checkins`, `checkin_content`, `shifts` |
| `supabase/migrations/20260908000006_domain_plan.sql` | `routine_items`, `completions`, `adhoc_tasks` |
| `supabase/migrations/20260908000007_helper_functions.sql` | `app.is_member` / `circle_role` / `is_family` / `is_org_owner` |
| `supabase/migrations/20260908000008_rls_select.sql` | `ENABLE`+`FORCE` on all tables; membership `SELECT` policies |
| `supabase/migrations/20260908000009_rls_checkin_content.sql` | The single combined tier `SELECT` policy |
| `supabase/migrations/20260908000010_rls_writes_checkins.sql` | `checkins` + `checkin_content` write policies |
| `supabase/migrations/20260908000011_rls_writes_schedule.sql` | `shifts` / `routine_items` / `completions` / `adhoc_tasks` write policies |
| `supabase/migrations/20260908000012_rls_writes_membership.sql` | `circle_members` / `invites` / `circles` / `organizations` write policies |
| `supabase/migrations/20260908000013_immutability_triggers.sql` | Frozen columns; caregiver/removed_at column-scope; denorm freeze; elder consistency |
| `supabase/migrations/20260908000014_last_coordinator_guard.sql` | Guard trigger with `SELECT … FOR UPDATE` |
| `supabase/migrations/20260908000015_lockdown_grants.sql` | `REVOKE` from `anon`/`authenticated`; explicit `GRANT`s to `app_authenticated` |
| `server/test/db/clients.ts` | `rawNoClaims()`, `asUser(claims, fn)`, `postgrest(path, jwt)`, `mintJwt(claims)` |
| `server/test/db/fixture.ts` | Inserts `auth.users`; builds 2 orgs / 3 circles / memberships / seeded check-ins |
| `server/test/db/select-matrix.test.ts` | Tenant `SELECT` isolation matrix |
| `server/test/db/checkin-content.test.ts` | Consent-tier matrix + base-table-direct |
| `server/test/db/write-matrix.test.ts` | §5 writes table, deny + allow |
| `server/test/db/guards.test.ts` | Triggers: last-coordinator, immutability, `handle_new_user` |
| `server/test/db/bypass.test.ts` | Claims leakage, PostgREST-direct, migration idempotency |
| `server/vitest.config.ts` | Vitest config (node env, single worker) |
| `.github/workflows/db.yml` | CI: start Supabase, apply migrations twice, run `server` DB tests |

---

## Task 1: Scaffold the Supabase project and test tooling

**Files:**
- Create: `supabase/config.toml` (via `supabase init`, then edited)
- Modify: `server/package.json`
- Create: `server/vitest.config.ts`
- Create: `server/test/db/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm --prefix server run test:db` runs Vitest against `server/test/db/**`. Local stack up via `supabase start`.

- [ ] **Step 1: Initialise Supabase**

Run from repo root:
```bash
npx --yes supabase@latest init
```
This creates `supabase/config.toml` and `supabase/.gitignore`. Accept defaults (no VS Code settings, no Deno).

- [ ] **Step 2: Pin the exposed schema so PostgREST never serves `public`**

Edit `supabase/config.toml`. Under `[api]` set:
```toml
[api]
enabled = true
port = 54121
schemas = ["graphql_public"]
extra_search_path = ["extensions"]
max_rows = 1000
```
`schemas` deliberately omits `public` and `storage` — the browser's anon/JWT calls to `/rest/v1/*` will find nothing. (Part 1c re-adds `storage` only if a direct-upload path is ever needed; it is not in this MVP.)

- [ ] **Step 3: Add test dependencies to the server package**

Run:
```bash
npm --prefix server install -D vitest@^2 pg@^8.13 @types/pg@^8.11 jose@^5
```
Then add scripts to `server/package.json` `"scripts"`:
```json
"test:db": "vitest run --config vitest.config.ts",
"test:db:watch": "vitest --config vitest.config.ts"
```

- [ ] **Step 4: Write the Vitest config**

Create `server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

// DB tests share one local Postgres — run them in a single worker so the
// per-test fixture reset in fixture.ts is not racing another file.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Ignore local Supabase artefacts**

Append to `.gitignore`:
```
# Supabase local stack
supabase/.branches/
supabase/.temp/
```
Create an empty `server/test/db/.gitkeep`.

- [ ] **Step 6: Verify the stack starts and commit**

Run:
```bash
npx supabase start
npx supabase status
```
Expected: prints API URL `http://127.0.0.1:54121`, DB URL on `54122`, plus `anon key` and `service_role key`. Then:
```bash
npx supabase stop
git add supabase/config.toml supabase/.gitignore server/package.json server/package-lock.json server/vitest.config.ts server/test/db/.gitkeep .gitignore
git commit -m "chore(1a): scaffold Supabase local stack + Vitest DB harness"
```

---

## Task 2: Migration — roles, extensions, enums

**Files:**
- Create: `supabase/migrations/20260908000001_roles_extensions_enums.sql`

**Interfaces:**
- Produces: role `app_authenticated` (LOGIN, password `app_authenticated` for local/CI only); schema `app`; the six enums listed in Global Constraints.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000001_roles_extensions_enums.sql`:
```sql
-- Extensions ---------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- Dedicated schema for RLS helper functions ------------------------------
create schema if not exists app;

-- The role the API's request pool logs in as. NOT a Supabase-generated
-- role. No BYPASSRLS. Every RLS policy targets this role by name.
-- The password is only used by the local stack and CI; production sets it
-- out of band and passes it via DATABASE_URL.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_authenticated') then
    create role app_authenticated login password 'app_authenticated' noinherit;
  end if;
end $$;

-- app_authenticated must be able to reach the schemas (row access is still
-- gated by RLS; table-level GRANTs come in migration 015).
grant usage on schema public to app_authenticated;
grant usage on schema app to app_authenticated;

-- Enums -----------------------------------------------------------------
create type org_kind as enum ('family', 'agency');
create type circle_role as enum ('elder', 'coordinator', 'caregiver', 'family');
create type mood as enum ('good', 'ok', 'hard');
create type checkin_visibility as enum ('circle', 'family', 'coordinator', 'mood_only');
create type task_category as enum ('medication', 'personal_care', 'meal', 'rest', 'activity', 'other');
create type activity_tag as enum (
  'companionship', 'mobility', 'outing', 'meal_prep', 'hygiene', 'medical', 'household', 'other'
);
```

- [ ] **Step 2: Apply and verify**

Run:
```bash
npx supabase start
npx supabase db reset
```
Expected: reset completes with no error; the message lists `20260908000001` applied.

- [ ] **Step 3: Verify objects exist**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "\dT public.*" -c "\dn app" -c "\du app_authenticated"
```
Expected: the six enums listed, schema `app` present, role `app_authenticated` with `Login` attribute and **no** `Bypass RLS`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260908000001_roles_extensions_enums.sql
git commit -m "feat(1a): migration 001 — app_authenticated role, app schema, enums"
```

---

## Task 3: Migration — tenancy core (`profiles`, `organizations`, `circles`)

**Files:**
- Create: `supabase/migrations/20260908000002_tenancy_core.sql`

**Interfaces:**
- Consumes: enums + `citext` from migration 001.
- Produces: tables `public.profiles` (id = `auth.users.id`), `public.organizations`, `public.circles` with the constraints from §4.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000002_tenancy_core.sql`:
```sql
-- profiles: app mirror of auth.users, populated by a trigger (migration 004)
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  citext not null,
  full_name              text not null,
  ui_lang                text not null default 'en' check (ui_lang in ('en', 'fr')),
  tos_accepted_at        timestamptz,
  privacy_notice_version text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          org_kind not null default 'family',
  owner_user_id uuid not null references public.profiles (id) on delete restrict,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index organizations_owner_idx on public.organizations (owner_user_id);

create table public.circles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  elder_user_id uuid references public.profiles (id) on delete set null,
  elder_name    text not null,
  elder_lang    text not null default 'ar',
  timezone      text not null,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index circles_org_idx on public.circles (org_id);
-- one elder account is the elder of at most one circle
create unique index circles_one_elder_per_user
  on public.circles (elder_user_id) where elder_user_id is not null;
```

- [ ] **Step 2: Apply and verify**

Run `npx supabase db reset`. Expected: success through migration `20260908000002`.

- [ ] **Step 3: Verify the FK to `auth.users` resolves**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "\d public.profiles" -c "\d public.circles"
```
Expected: `profiles.id` FK → `auth.users(id)`; `circles_one_elder_per_user` partial unique index present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260908000002_tenancy_core.sql
git commit -m "feat(1a): migration 002 — profiles, organizations, circles"
```

---

## Task 4: Migration — membership and invites

**Files:**
- Create: `supabase/migrations/20260908000003_membership_invites.sql`

**Interfaces:**
- Consumes: `circles`, `profiles`, `circle_role` enum.
- Produces: `public.circle_members` (partial-unique on active membership, partial-unique on active elder), `public.invites` (partial-unique on pending email).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000003_membership_invites.sql`:
```sql
create table public.circle_members (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             circle_role not null,
  is_family_member boolean not null default true,
  invited_by       uuid references public.profiles (id) on delete set null,
  joined_at        timestamptz not null default now(),
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- a person has at most one active membership per circle (soft-removed rows
-- do not count, so a removed member can be re-invited)
create unique index circle_members_one_active
  on public.circle_members (circle_id, user_id) where removed_at is null;
-- at most one active elder per circle
create unique index circle_members_one_elder
  on public.circle_members (circle_id) where role = 'elder' and removed_at is null;
create index circle_members_lookup
  on public.circle_members (user_id, circle_id) where removed_at is null;

create table public.invites (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  email            citext not null,
  role             circle_role not null,
  is_family_member boolean not null default true,
  token            text not null unique,
  invited_by       uuid not null references public.profiles (id) on delete restrict,
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index invites_email_idx on public.invites (email);
-- one email cannot pile up pending invites to the same circle
create unique index invites_one_pending_per_email
  on public.invites (circle_id, email) where accepted_at is null;
```

- [ ] **Step 2: Apply and verify**

Run `npx supabase db reset`. Then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "\d public.circle_members" -c "\d public.invites"
```
Expected: three partial indexes on `circle_members`; `invites_one_pending_per_email` present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000003_membership_invites.sql
git commit -m "feat(1a): migration 003 — circle_members, invites"
```

---

## Task 5: Migration — `handle_new_user()` and the `updated_at` touch trigger

**Files:**
- Create: `supabase/migrations/20260908000004_triggers_profiles_touch.sql`

**Interfaces:**
- Produces: trigger on `auth.users` insert → `public.profiles` row; `app.set_updated_at()` attached to every mutable table.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000004_triggers_profiles_touch.sql`:
```sql
-- Populate profiles on signup. SECURITY DEFINER + owned by postgres so it
-- writes past profiles' RLS. full_name can never be null and is bounded,
-- so a magic-link signup carrying no metadata cannot 500. (spec §4, S8)
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        split_part(new.email, '@', 1)
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Generic updated_at bump.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_profiles       before update on public.profiles       for each row execute function app.set_updated_at();
create trigger touch_organizations  before update on public.organizations  for each row execute function app.set_updated_at();
create trigger touch_circles        before update on public.circles        for each row execute function app.set_updated_at();
create trigger touch_circle_members before update on public.circle_members for each row execute function app.set_updated_at();
```

- [ ] **Step 2: Apply and smoke-test the trigger**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't1@example.com', '', now(), now(), '{}', '{}');" -c "select id, email, full_name from public.profiles;"
```
Expected: one `profiles` row, `full_name = 't1'` (derived from the email local-part because metadata was empty).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000004_triggers_profiles_touch.sql
git commit -m "feat(1a): migration 004 — handle_new_user + updated_at triggers"
```

---

## Task 6: Migration — `checkins`, `checkin_content`, `shifts`

**Files:**
- Create: `supabase/migrations/20260908000005_domain_checkins_shifts.sql`

**Interfaces:**
- Consumes: `circles`, `profiles`, enums `mood`, `checkin_visibility`, `activity_tag`.
- Produces: `public.checkins`, `public.checkin_content` (1:1, with frozen denormalized `circle_id` / `visibility` / `recorded_by` / `is_proxy`), `public.shifts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000005_domain_checkins_shifts.sql`:
```sql
create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references public.circles (id) on delete cascade,
  occurred_on date not null,
  mood        mood not null,
  spoken_lang text not null,
  visibility  checkin_visibility not null default 'family',
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  is_proxy    boolean not null default false,
  created_via text not null default 'live' check (created_via in ('live', 'demo')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index checkins_circle_day_idx on public.checkins (circle_id, occurred_on desc);

-- Words + audio. Its own RLS tier policy (migration 009). The four
-- denormalized columns are copied from the parent row by a trigger
-- (migration 013) and frozen, so the tier policy is self-contained and
-- never subqueries checkins. (spec §4, D12)
create table public.checkin_content (
  checkin_id  uuid primary key references public.checkins (id) on delete cascade,
  circle_id   uuid not null references public.circles (id) on delete cascade,
  visibility  checkin_visibility not null,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  is_proxy    boolean not null,
  transcript  text not null default '',
  translation text not null default '',
  audio_path  text check (audio_path is null or audio_path like circle_id::text || '/%'),
  created_at  timestamptz not null default now()
);
create index checkin_content_circle_idx on public.checkin_content (circle_id);

create table public.shifts (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  caregiver_id     uuid references public.profiles (id) on delete set null,
  purpose          text not null default '',
  activity_tags    activity_tag[] not null default '{}',
  coordinator_note text,
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at),
  constraint shifts_checkout_needs_checkin
    check (checked_out_at is null or checked_in_at is not null)
);
create index shifts_circle_start_idx on public.shifts (circle_id, starts_at);

create trigger touch_checkins before update on public.checkins for each row execute function app.set_updated_at();
create trigger touch_shifts   before update on public.shifts   for each row execute function app.set_updated_at();
```

- [ ] **Step 2: Apply and verify the CHECK constraints**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "\d public.checkin_content" -c "\d public.shifts"
```
Expected: `checkin_content.audio_path` CHECK present; `shifts_time_order` and `shifts_checkout_needs_checkin` present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000005_domain_checkins_shifts.sql
git commit -m "feat(1a): migration 005 — checkins, checkin_content, shifts"
```

---

## Task 7: Migration — `routine_items`, `completions`, `adhoc_tasks`

**Files:**
- Create: `supabase/migrations/20260908000006_domain_plan.sql`

**Interfaces:**
- Produces: `public.routine_items` (with `unique (id, circle_id)` so children can compose-FK, `effective_from`, weekdays CHECK), `public.completions` (composite FK to the same circle), `public.adhoc_tasks`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000006_domain_plan.sql`:
```sql
create table public.routine_items (
  id             uuid not null default gen_random_uuid(),
  circle_id      uuid not null references public.circles (id) on delete cascade,
  title          text not null,
  time_of_day    time not null,
  category       task_category not null default 'other',
  time_sensitive boolean not null default false,
  weekdays       smallint[] not null,
  effective_from date not null default current_date,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (id),
  constraint routine_items_weekdays_valid check (
    weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    and array_length(weekdays, 1) between 1 and 7
  ),
  -- lets completions compose-FK on (routine_item_id, circle_id)
  constraint routine_items_id_circle_uq unique (id, circle_id)
);
create index routine_items_circle_idx on public.routine_items (circle_id);

create table public.completions (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references public.circles (id) on delete cascade,
  routine_item_id uuid not null,
  on_date         date not null,
  done_at         timestamptz not null default now(),
  done_by         uuid not null references public.profiles (id) on delete restrict,
  note            text,
  created_at      timestamptz not null default now(),
  -- the routine item MUST belong to this completion's circle
  constraint completions_item_same_circle
    foreign key (routine_item_id, circle_id)
    references public.routine_items (id, circle_id) on delete cascade,
  constraint completions_one_per_item_day unique (routine_item_id, on_date)
);
create index completions_circle_day_idx on public.completions (circle_id, on_date);

create table public.adhoc_tasks (
  id             uuid primary key default gen_random_uuid(),
  circle_id      uuid not null references public.circles (id) on delete cascade,
  on_date        date not null,
  title          text not null,
  time_of_day    time not null,
  category       task_category not null default 'other',
  time_sensitive boolean not null default false,
  added_by       uuid not null references public.profiles (id) on delete restrict,
  done_at        timestamptz,
  done_by        uuid references public.profiles (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index adhoc_tasks_circle_day_idx on public.adhoc_tasks (circle_id, on_date);

create trigger touch_routine_items before update on public.routine_items for each row execute function app.set_updated_at();
create trigger touch_adhoc_tasks   before update on public.adhoc_tasks   for each row execute function app.set_updated_at();
```

- [ ] **Step 2: Apply and verify the composite FK**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "\d public.completions"
```
Expected: FK `completions_item_same_circle` on `(routine_item_id, circle_id)` → `routine_items(id, circle_id)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000006_domain_plan.sql
git commit -m "feat(1a): migration 006 — routine_items, completions, adhoc_tasks"
```

---

## Task 8: Migration — RLS helper functions

**Files:**
- Create: `supabase/migrations/20260908000007_helper_functions.sql`

**Interfaces:**
- Produces: `app.is_member(uuid) -> boolean`, `app.circle_role(uuid) -> circle_role`, `app.is_family(uuid) -> boolean`, `app.is_org_owner(uuid) -> boolean`. All read `public.circle_members` / `public.circles` / `public.organizations` past RLS (owner `postgres`, `BYPASSRLS`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000007_helper_functions.sql`:
```sql
-- Membership truth. SECURITY DEFINER + owned by postgres (BYPASSRLS) so a
-- policy on circle_members that calls is_member() does not recurse into
-- its own policy. STABLE: one evaluation per statement per argument.
-- search_path = '' forces every identifier to be schema-qualified. (D14)

create or replace function app.is_member(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = circle
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  );
$$;

create or replace function app.circle_role(circle uuid)
returns circle_role language sql stable security definer set search_path = '' as $$
  select m.role from public.circle_members m
  where m.circle_id = circle
    and m.user_id = (select auth.uid())
    and m.removed_at is null
  limit 1;
$$;

create or replace function app.is_family(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.is_family_member from public.circle_members m
    where m.circle_id = circle
      and m.user_id = (select auth.uid())
      and m.removed_at is null
    limit 1
  ), false);
$$;

create or replace function app.is_org_owner(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.circles c
    join public.organizations o on o.id = c.org_id
    where c.id = circle
      and o.owner_user_id = (select auth.uid())
  );
$$;

-- app_authenticated must be able to call them
grant execute on function app.is_member(uuid)     to app_authenticated;
grant execute on function app.circle_role(uuid)   to app_authenticated;
grant execute on function app.is_family(uuid)     to app_authenticated;
grant execute on function app.is_org_owner(uuid)  to app_authenticated;
```

- [ ] **Step 2: Apply and confirm ownership**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "select proname, prosecdef, (select rolname from pg_roles where oid = proowner) as owner from pg_proc where pronamespace = 'app'::regnamespace and proname like 'is_%' or proname = 'circle_role';"
```
Expected: `prosecdef = t` (security definer) and `owner = postgres` for all four.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000007_helper_functions.sql
git commit -m "feat(1a): migration 007 — app.is_member/circle_role/is_family/is_org_owner"
```

---

## Task 9: Migration — enable/force RLS and the membership `SELECT` policies

**Files:**
- Create: `supabase/migrations/20260908000008_rls_select.sql`

**Interfaces:**
- Consumes: helper functions from migration 007.
- Produces: `ENABLE`+`FORCE ROW LEVEL SECURITY` on all 11 tenant tables; a `SELECT` policy on every table **except** `checkin_content` (that one is migration 009).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000008_rls_select.sql`:
```sql
-- Enable + FORCE on every tenant table (FORCE so even the table owner is
-- subject to RLS; the API pool is app_authenticated, never the owner).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','organizations','circles','circle_members','invites',
    'checkins','checkin_content','shifts','routine_items','completions','adhoc_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Circle-scoped tables with NO per-row visibility model: a member sees all
-- rows for their circles. Every /api/circles/:cid handler ALSO filters
-- circle_id = :cid in SQL (spec §5) — RLS is the safety net, not the scope.
create policy sel_checkins     on public.checkins        for select to app_authenticated using (app.is_member(circle_id));
create policy sel_shifts       on public.shifts          for select to app_authenticated using (app.is_member(circle_id));
create policy sel_routine      on public.routine_items   for select to app_authenticated using (app.is_member(circle_id));
create policy sel_completions  on public.completions     for select to app_authenticated using (app.is_member(circle_id));
create policy sel_adhoc        on public.adhoc_tasks     for select to app_authenticated using (app.is_member(circle_id));
create policy sel_circles      on public.circles         for select to app_authenticated using (app.is_member(id));
create policy sel_circle_members on public.circle_members for select to app_authenticated using (app.is_member(circle_id));
create policy sel_invites      on public.invites         for select to app_authenticated using (app.is_member(circle_id));

-- organizations: the owner, OR any member of one of its circles (so invited
-- staff can read is_demo for GET /api/me). (spec §5 / C8)
create policy sel_organizations on public.organizations for select to app_authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (
      select 1 from public.circles c
      where c.org_id = organizations.id and app.is_member(c.id)
    )
  );

-- profiles: yourself, or anyone who shares a circle with you.
create policy sel_profiles on public.profiles for select to app_authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.circle_members me
      join public.circle_members them on them.circle_id = me.circle_id
      where me.user_id = (select auth.uid()) and me.removed_at is null
        and them.user_id = public.profiles.id and them.removed_at is null
    )
  );
```

- [ ] **Step 2: Apply and verify FORCE is on**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;"
```
Expected: `relrowsecurity` and `relforcerowsecurity` both `t` for all 11 tables.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000008_rls_select.sql
git commit -m "feat(1a): migration 008 — enable/force RLS + membership SELECT policies"
```

---

## Task 10: Migration — the `checkin_content` consent-tier `SELECT` policy

**Files:**
- Create: `supabase/migrations/20260908000009_rls_checkin_content.sql`

**Interfaces:**
- Produces: exactly one `SELECT` policy on `checkin_content` combining membership AND the §5 tier matrix. No baseline `is_member` policy on this table (two PERMISSIVE policies would OR — C6).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000009_rls_checkin_content.sql`:
```sql
-- ONE policy. membership AND tier, in a single USING expression, so there
-- is nothing to OR past. A viewer without "full" gets zero rows. (C1, C6)
-- Columns visibility / recorded_by / is_proxy are the frozen denormalized
-- copies on this table (migration 013) — the policy never touches checkins.
create policy sel_checkin_content on public.checkin_content
  for select to app_authenticated
  using (
    app.is_member(circle_id)
    and (
      recorded_by = (select auth.uid())              -- your own recording, any tier
      or case visibility
           when 'circle' then true
           when 'family' then
             app.circle_role(circle_id) = 'coordinator'
             or app.is_family(circle_id)
           when 'coordinator' then
             app.circle_role(circle_id) = 'coordinator'
           when 'mood_only' then false
         end
    )
  );
```

- [ ] **Step 2: Apply**

Run `npx supabase db reset`. Expected: success through `20260908000009`.

- [ ] **Step 3: Verify there is exactly one SELECT policy**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "select policyname, cmd, roles from pg_policies where tablename = 'checkin_content';"
```
Expected: a single row, `cmd = SELECT`, `roles = {app_authenticated}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260908000009_rls_checkin_content.sql
git commit -m "feat(1a): migration 009 — checkin_content consent-tier SELECT policy"
```

---

## Task 11: Migration — write policies for `checkins` and `checkin_content`

**Files:**
- Create: `supabase/migrations/20260908000010_rls_writes_checkins.sql`

**Interfaces:**
- Produces: INSERT/UPDATE/DELETE policies for `checkins` and INSERT/UPDATE/DELETE for `checkin_content`, per the §5 writes table. Column-level immutability (only `visibility` may change on UPDATE; `recorded_by`/`circle_id` frozen) is enforced by triggers in migration 013 — these policies gate *rows*.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000010_rls_writes_checkins.sql`:
```sql
-- INSERT: an elder/coordinator/caregiver of the circle, recording as
-- themselves, with is_proxy consistent with their role.
create policy ins_checkins on public.checkins
  for insert to app_authenticated
  with check (
    app.circle_role(circle_id) in ('elder','coordinator','caregiver')
    and recorded_by = (select auth.uid())
    and is_proxy = (app.circle_role(circle_id) <> 'elder')
  );

-- UPDATE: non-proxy check-ins — only the elder. Proxy check-ins — the
-- elder, the recorder, or a coordinator. (Column scope: trigger 013 limits
-- the change to `visibility`.) The elder may only touch a check-in whose
-- content she can see: recorded by her, or a tier that admits her.
create policy upd_checkins on public.checkins
  for update to app_authenticated
  using (
    case
      when not is_proxy then app.circle_role(circle_id) = 'elder'
      else app.circle_role(circle_id) = 'elder'
           or recorded_by = (select auth.uid())
           or app.circle_role(circle_id) = 'coordinator'
    end
    and (
      recorded_by = (select auth.uid())
      or app.circle_role(circle_id) = 'coordinator'
      or visibility in ('circle','family')
    )
  )
  with check (true);

create policy del_checkins on public.checkins
  for delete to app_authenticated
  using (
    case
      when not is_proxy then app.circle_role(circle_id) = 'elder'
      else app.circle_role(circle_id) = 'elder'
           or recorded_by = (select auth.uid())
           or app.circle_role(circle_id) = 'coordinator'
    end
  );

-- checkin_content mirrors its parent: you may write the content row iff you
-- may write the parent checkins row for the same circle and recorder.
create policy ins_checkin_content on public.checkin_content
  for insert to app_authenticated
  with check (
    app.circle_role(circle_id) in ('elder','coordinator','caregiver')
    and recorded_by = (select auth.uid())
  );

create policy upd_checkin_content on public.checkin_content
  for update to app_authenticated
  using (
    recorded_by = (select auth.uid())
    or app.circle_role(circle_id) = 'coordinator'
    or (app.circle_role(circle_id) = 'elder' and not is_proxy)
  )
  with check (true);

create policy del_checkin_content on public.checkin_content
  for delete to app_authenticated
  using (
    recorded_by = (select auth.uid())
    or app.circle_role(circle_id) = 'coordinator'
    or (app.circle_role(circle_id) = 'elder' and not is_proxy)
  );
```

- [ ] **Step 2: Apply**

Run `npx supabase db reset`. Expected: success through `20260908000010`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000010_rls_writes_checkins.sql
git commit -m "feat(1a): migration 010 — checkins + checkin_content write policies"
```

---

## Task 12: Migration — write policies for the schedule tables

**Files:**
- Create: `supabase/migrations/20260908000011_rls_writes_schedule.sql`

**Interfaces:**
- Produces: write policies for `shifts`, `routine_items`, `completions`, `adhoc_tasks` per §5. Caregiver-only-column scope on `shifts` UPDATE is a trigger (013); these gate rows and roles.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000011_rls_writes_schedule.sql`:
```sql
-- shifts: coordinator does everything; an assigned caregiver may UPDATE
-- (trigger 013 limits them to checked_in_at / checked_out_at).
create policy ins_shifts on public.shifts for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');
create policy upd_shifts on public.shifts for update to app_authenticated
  using (
    app.circle_role(circle_id) = 'coordinator'
    or caregiver_id = (select auth.uid())
  )
  with check (
    app.circle_role(circle_id) = 'coordinator'
    or caregiver_id = (select auth.uid())
  );
create policy del_shifts on public.shifts for delete to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator');

-- routine_items: coordinator only.
create policy ins_routine on public.routine_items for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');
create policy upd_routine on public.routine_items for update to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator')
  with check (app.circle_role(circle_id) = 'coordinator');
create policy del_routine on public.routine_items for delete to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator');

-- completions: coordinator or caregiver.
create policy ins_completions on public.completions for insert to app_authenticated
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy upd_completions on public.completions for update to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'))
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy del_completions on public.completions for delete to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'));

-- adhoc_tasks: coordinator or caregiver may add/complete; delete is
-- coordinator OR the person who added it.
create policy ins_adhoc on public.adhoc_tasks for insert to app_authenticated
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy upd_adhoc on public.adhoc_tasks for update to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'))
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy del_adhoc on public.adhoc_tasks for delete to app_authenticated
  using (
    app.circle_role(circle_id) = 'coordinator'
    or added_by = (select auth.uid())
  );
```

- [ ] **Step 2: Apply and commit**

```bash
npx supabase db reset
git add supabase/migrations/20260908000011_rls_writes_schedule.sql
git commit -m "feat(1a): migration 011 — shifts/routine/completions/adhoc write policies"
```

---

## Task 13: Migration — write policies for membership, invites, circles, organizations

**Files:**
- Create: `supabase/migrations/20260908000012_rls_writes_membership.sql`

**Interfaces:**
- Produces: `circle_members` UPDATE (coordinator; column scope + guard are triggers 013/014) with **no** INSERT policy (service_role only); `invites` INSERT (coordinator); no INSERT policy on `circles`/`organizations` (service_role only). Because `FORCE RLS` + no policy = deny, the absence of an INSERT policy is the lock.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000012_rls_writes_membership.sql`:
```sql
-- circle_members: a coordinator may UPDATE (trigger 013 limits the change
-- to removed_at; trigger 014 blocks removing the owner or the last
-- coordinator). No INSERT / DELETE policy -> only a BYPASSRLS connection
-- (the API's admin pool, on invite acceptance) can add rows.
create policy upd_circle_members on public.circle_members
  for update to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator')
  with check (app.circle_role(circle_id) = 'coordinator');

-- invites: a coordinator of the circle may create them.
create policy ins_invites on public.invites
  for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');

-- circles / organizations: no INSERT, UPDATE(circles), or DELETE policy for
-- app_authenticated. Onboarding and deletion run on the admin pool.
-- organizations UPDATE stays owner-only for future settings screens.
create policy upd_organizations on public.organizations
  for update to app_authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));
```

- [ ] **Step 2: Apply and verify no INSERT policy exists on the locked tables**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "select tablename, cmd, policyname from pg_policies where tablename in ('circles','organizations','circle_members','invites') order by tablename, cmd;"
```
Expected: no `INSERT` row for `circles`, `organizations`, or `circle_members`; one `INSERT` row for `invites`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000012_rls_writes_membership.sql
git commit -m "feat(1a): migration 012 — membership/invite/circle write policies"
```

---

## Task 14: Migration — immutability and column-scope triggers

**Files:**
- Create: `supabase/migrations/20260908000013_immutability_triggers.sql`

**Interfaces:**
- Produces: `BEFORE INSERT/UPDATE` triggers enforcing — frozen `circle_id` + all `*_by` columns; `checkin_content` denormalized columns copied from parent at insert and frozen; a caregiver's `shifts` UPDATE limited to `{checked_in_at, checked_out_at}`; a coordinator's `circle_members` UPDATE limited to `{removed_at}`; `circles.elder_user_id` ↔ `circle_members` elder-row consistency.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000013_immutability_triggers.sql`:
```sql
-- Freeze circle_id + attribution columns on the domain tables. ----------
create or replace function app.freeze_attribution()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id then
    raise exception 'circle_id is immutable';
  end if;
  return new;
end $$;

create or replace function app.freeze_checkins_recorder()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id
     or new.recorded_by is distinct from old.recorded_by
     or new.is_proxy is distinct from old.is_proxy then
    raise exception 'circle_id / recorded_by / is_proxy are immutable';
  end if;
  return new;
end $$;

create trigger freeze_checkins       before update on public.checkins       for each row execute function app.freeze_checkins_recorder();
create trigger freeze_shifts         before update on public.shifts         for each row execute function app.freeze_attribution();
create trigger freeze_routine_items  before update on public.routine_items  for each row execute function app.freeze_attribution();

create or replace function app.freeze_authored_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id then
    raise exception 'circle_id is immutable';
  end if;
  if tg_table_name = 'completions' and new.done_by is distinct from old.done_by then
    raise exception 'done_by is immutable';
  end if;
  if tg_table_name = 'adhoc_tasks' and new.added_by is distinct from old.added_by then
    raise exception 'added_by is immutable';
  end if;
  return new;
end $$;
create trigger freeze_completions before update on public.completions for each row execute function app.freeze_authored_by();
create trigger freeze_adhoc       before update on public.adhoc_tasks for each row execute function app.freeze_authored_by();

-- checkin_content: copy the denormalized columns from the parent at insert,
-- freeze them on update EXCEPT visibility, which tracks a parent change. --
create or replace function app.checkin_content_denorm()
returns trigger language plpgsql set search_path = '' as $$
declare parent public.checkins;
begin
  select * into parent from public.checkins where id = new.checkin_id;
  if not found then
    raise exception 'checkin_content.checkin_id % has no parent', new.checkin_id;
  end if;
  if tg_op = 'INSERT' then
    new.circle_id   := parent.circle_id;
    new.visibility  := parent.visibility;
    new.recorded_by := parent.recorded_by;
    new.is_proxy    := parent.is_proxy;
  else
    if new.circle_id is distinct from old.circle_id
       or new.recorded_by is distinct from old.recorded_by
       or new.is_proxy is distinct from old.is_proxy then
      raise exception 'circle_id / recorded_by / is_proxy are immutable on checkin_content';
    end if;
    -- visibility may only move in lockstep with the parent
    new.visibility := parent.visibility;
  end if;
  return new;
end $$;
create trigger denorm_checkin_content
  before insert or update on public.checkin_content
  for each row execute function app.checkin_content_denorm();

-- Caregiver's shifts UPDATE: only the two visit-verification columns. ----
create or replace function app.shifts_column_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Admin-pool writes (seed, migrations) carry no JWT claims -> auth.uid()
  -- is null. Those paths are trusted; do not apply the caregiver clamp.
  if (select auth.uid()) is null then
    return new;
  end if;
  if app.circle_role(new.circle_id) = 'coordinator' then
    return new;  -- coordinator may change anything the policy allowed
  end if;
  if new.caregiver_id is distinct from old.caregiver_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.purpose is distinct from old.purpose
     or new.activity_tags is distinct from old.activity_tags
     or new.coordinator_note is distinct from old.coordinator_note then
    raise exception 'a caregiver may only change checked_in_at / checked_out_at';
  end if;
  return new;
end $$;
create trigger shifts_column_scope before update on public.shifts
  for each row execute function app.shifts_column_scope();

-- Coordinator's circle_members UPDATE: only removed_at. The admin pool
-- (invite acceptance un-removing a soft-removed member, which also rewrites
-- role / is_family_member) runs with no claims -> auth.uid() null -> trusted.
create or replace function app.circle_members_column_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_family_member is distinct from old.is_family_member
     or new.user_id is distinct from old.user_id
     or new.circle_id is distinct from old.circle_id
     or new.invited_by is distinct from old.invited_by then
    raise exception 'only removed_at may change on circle_members';
  end if;
  return new;
end $$;
create trigger circle_members_column_scope before update on public.circle_members
  for each row execute function app.circle_members_column_scope();

-- circles.elder_user_id must match the active elder membership. ----------
create or replace function app.assert_elder_consistency()
returns trigger language plpgsql set search_path = '' as $$
declare elder_membership uuid;
begin
  select m.user_id into elder_membership
  from public.circle_members m
  where m.circle_id = coalesce(new.circle_id, old.circle_id)
    and m.role = 'elder' and m.removed_at is null
  limit 1;
  -- resolve which row we are validating
  if tg_table_name = 'circles' then
    if new.elder_user_id is distinct from elder_membership then
      raise exception 'circles.elder_user_id (%) must equal the active elder membership (%)',
        new.elder_user_id, elder_membership;
    end if;
  end if;
  return new;
end $$;
create constraint trigger circles_elder_consistency
  after update of elder_user_id on public.circles
  deferrable initially deferred
  for each row execute function app.assert_elder_consistency();
```

- [ ] **Step 2: Apply**

Run `npx supabase db reset`. Expected: success through `20260908000013`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000013_immutability_triggers.sql
git commit -m "feat(1a): migration 013 — immutability + column-scope + denorm triggers"
```

---

## Task 15: Migration — last-coordinator / owner removal guard

**Files:**
- Create: `supabase/migrations/20260908000014_last_coordinator_guard.sql`

**Interfaces:**
- Produces: a `BEFORE UPDATE` trigger on `circle_members` that, when `removed_at` transitions from null to non-null, takes `SELECT … FOR UPDATE` on the `circles` row (serialising concurrent removals) and rejects removing the org owner or the last active coordinator.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000014_last_coordinator_guard.sql`:
```sql
create or replace function app.guard_member_removal()
returns trigger language plpgsql set search_path = '' as $$
declare
  owner uuid;
  remaining_coordinators int;
begin
  -- only fire on an actual removal
  if old.removed_at is not null or new.removed_at is null then
    return new;
  end if;

  -- serialise all removals for this circle
  perform 1 from public.circles c where c.id = old.circle_id for update;

  select o.owner_user_id into owner
  from public.circles c join public.organizations o on o.id = c.org_id
  where c.id = old.circle_id;

  if old.user_id = owner then
    raise exception 'cannot remove the organization owner from their circle';
  end if;

  if old.role = 'coordinator' then
    select count(*) into remaining_coordinators
    from public.circle_members m
    where m.circle_id = old.circle_id
      and m.role = 'coordinator'
      and m.removed_at is null
      and m.id <> old.id;
    if remaining_coordinators = 0 then
      raise exception 'cannot remove the last coordinator of a circle';
    end if;
  end if;

  return new;
end $$;

create trigger guard_member_removal
  before update on public.circle_members
  for each row execute function app.guard_member_removal();
```

- [ ] **Step 2: Apply and commit**

```bash
npx supabase db reset
git add supabase/migrations/20260908000014_last_coordinator_guard.sql
git commit -m "feat(1a): migration 014 — last-coordinator/owner removal guard"
```

---

## Task 16: Migration — lock down `anon` / `authenticated`, grant `app_authenticated`

**Files:**
- Create: `supabase/migrations/20260908000015_lockdown_grants.sql`

**Interfaces:**
- Produces: `REVOKE ALL` in `public` from `anon` and `authenticated` (defence in depth behind the pinned exposed schema); explicit table-level DML grants to `app_authenticated`; `alter default privileges` so future tables inherit both.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000015_lockdown_grants.sql`:
```sql
-- The browser's anon key and any Supabase user JWT resolve to these roles.
-- PostgREST is already pinned away from `public` in config.toml; this makes
-- the lock explicit and survives a config mistake. (spec §3, D13)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The API pool (app_authenticated) needs row-level DML on every tenant
-- table; RLS still decides which rows.
grant select, insert, update, delete on all tables in schema public to app_authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_authenticated;
```

- [ ] **Step 2: Apply and verify the revoke**

Run `npx supabase db reset`, then:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54122/postgres" -c "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='checkins' order by grantee;"
```
Expected: `app_authenticated` has SELECT/INSERT/UPDATE/DELETE; `anon` and `authenticated` appear **nowhere** in the list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000015_lockdown_grants.sql
git commit -m "feat(1a): migration 015 — revoke anon/authenticated, grant app_authenticated"
```

---

## Task 17: Test harness — clients and fixture

**Files:**
- Create: `server/test/db/clients.ts`
- Create: `server/test/db/fixture.ts`
- Create: `server/test/db/smoke.test.ts`

**Interfaces:**
- Produces:
  - `rawNoClaims(): Promise<pg.Client>` — connects as `app_authenticated`, never sets `request.jwt.claims`.
  - `asUser<T>(userId: string, fn: (c: pg.Client) => Promise<T>): Promise<T>` — connects as `app_authenticated`, `BEGIN`, `select set_config('request.jwt.claims', $1, true)` with `{"sub": userId, "role":"authenticated", "email": <looked up>}` bound, runs `fn`, **`ROLLBACK`**, closes. For read-only matrix assertions.
  - `asUserCommitted<T>(userId: string, fn: (c: pg.Client) => Promise<T>): Promise<T>` — identical but **`COMMIT`s**. For write-matrix tests that must leave state behind (a caregiver checks in a shift, a member is removed). Callers reload the fixture per test (`beforeEach`).
  - `postgrest(path: string, jwt: string): Promise<Response>` — `fetch('http://127.0.0.1:54121' + path, { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + jwt } })`.
  - `mintJwt(claims: { sub: string; email: string }): Promise<string>` — HS256 over the local JWT secret.
  - `loadFixture(): Promise<Fixture>` — truncates tenant tables, inserts `auth.users` rows (trigger makes profiles), builds `Fixture` (see below).
- `Fixture` shape:
```ts
export interface Fixture {
  orgA: string; orgB: string;
  circleA1: string; circleA2: string; circleB1: string;   // A1,A2 in orgA; B1 in orgB
  users: Record<string, string>;   // label -> user_id, e.g. "A1_coordinator", "A1_elder", "A1_caregiver_hired", "A1_family", "twoCircle"
  checkins: Record<string, string>; // "A1_circle" | "A1_family" | "A1_coordinator" | "A1_moodonly" | "A1_proxy_coordinator" -> checkin id
}
```

- [ ] **Step 1: Write `clients.ts`**

Create `server/test/db/clients.ts`:
```ts
import { Client } from "pg";
import { SignJWT } from "jose";

const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:54122/postgres";
const APP_URL = "postgresql://app_authenticated:app_authenticated@127.0.0.1:54122/postgres";
const API_URL = "http://127.0.0.1:54121";
// Local Supabase fixed dev secret (supabase/config.toml [auth].jwt_secret default).
const JWT_SECRET = new TextEncoder().encode(
  "super-secret-jwt-token-with-at-least-32-characters-long",
);
// Local anon key is deterministic for the default secret.
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE";

export function admin(): Client {
  return new Client({ connectionString: ADMIN_URL });
}

/** app_authenticated with NO request.jwt.claims — proves fail-closed. */
export async function rawNoClaims(): Promise<Client> {
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  return c;
}

async function withClaims<T>(
  userId: string, fn: (c: Client) => Promise<T>, finish: "rollback" | "commit",
): Promise<T> {
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  try {
    const em = await c.query<{ email: string }>(
      "select email from public.profiles where id = $1",
      [userId],
    ).catch(() => ({ rows: [{ email: "unknown@example.com" }] }));
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", email: em.rows[0]?.email ?? "unknown@example.com" }),
    ]);
    const out = await fn(c);
    await c.query(finish);
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

/** app_authenticated inside a txn with claims set for `userId`. Rolls back. */
export const asUser = <T>(userId: string, fn: (c: Client) => Promise<T>) =>
  withClaims(userId, fn, "rollback");

/** Same, but COMMITs — for write-matrix tests that need committed state.
 *  The caller must reload the fixture per test (beforeEach). */
export const asUserCommitted = <T>(userId: string, fn: (c: Client) => Promise<T>) =>
  withClaims(userId, fn, "commit");

export async function mintJwt(claims: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ ...claims, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

export function postgrest(path: string, jwt: string): Promise<Response> {
  return fetch(API_URL + path, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
}
```

- [ ] **Step 2: Write `fixture.ts`**

Create `server/test/db/fixture.ts`:
```ts
import { randomUUID } from "node:crypto";
import { admin } from "./clients";

export interface Fixture {
  orgA: string; orgB: string;
  circleA1: string; circleA2: string; circleB1: string;
  users: Record<string, string>;
  checkins: Record<string, string>;
}

const USERS = [
  "A1_coordinator", "A1_elder", "A1_caregiver_hired", "A1_family",
  "A2_coordinator", "B1_coordinator", "twoCircle",
] as const;

async function mkUser(c: import("pg").Client, label: string): Promise<string> {
  const id = randomUUID();
  await c.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             $2,'',now(),now(),'{}', jsonb_build_object('full_name',$3))`,
    [id, `${label}@example.com`, label.replace(/_/g, " ")],
  );
  return id; // handle_new_user() created the profiles row
}

export async function loadFixture(): Promise<Fixture> {
  const c = admin();
  await c.connect();
  try {
    await c.query(`truncate table
      public.checkin_content, public.checkins, public.shifts,
      public.completions, public.adhoc_tasks, public.routine_items,
      public.invites, public.circle_members, public.circles,
      public.organizations restart identity cascade`);
    await c.query(`delete from auth.users where email like '%@example.com'`);

    const users: Record<string, string> = {};
    for (const label of USERS) users[label] = await mkUser(c, label);

    const orgA = randomUUID(), orgB = randomUUID();
    await c.query(`insert into public.organizations (id,name,kind,owner_user_id) values
      ($1,'Org A','family',$2), ($3,'Org B','family',$4)`,
      [orgA, users.A1_coordinator, orgB, users.B1_coordinator]);

    const circleA1 = randomUUID(), circleA2 = randomUUID(), circleB1 = randomUUID();
    await c.query(`insert into public.circles (id,org_id,name,elder_name,elder_lang,timezone) values
      ($1,$2,'A1','Amina','ar','America/Toronto'),
      ($3,$2,'A2','Bilal','fr','America/Toronto'),
      ($4,$5,'B1','Carmen','en','America/Toronto')`,
      [circleA1, orgA, circleA2, circleB1, orgB]);

    // memberships
    const mem = async (circle: string, user: string, role: string, fam: boolean) =>
      c.query(`insert into public.circle_members (circle_id,user_id,role,is_family_member)
               values ($1,$2,$3,$4)`, [circle, user, role, fam]);
    await mem(circleA1, users.A1_coordinator, "coordinator", true);
    await mem(circleA1, users.A1_elder, "elder", true);
    await mem(circleA1, users.A1_caregiver_hired, "caregiver", false);
    await mem(circleA1, users.A1_family, "family", true);
    await c.query(`update public.circles set elder_user_id=$1 where id=$2`,
      [users.A1_elder, circleA1]);
    await mem(circleA2, users.A2_coordinator, "coordinator", true);
    await mem(circleB1, users.B1_coordinator, "coordinator", true);
    // twoCircle is coordinator in A2 AND family in B1 — the multi-circle viewer
    await mem(circleA2, users.twoCircle, "coordinator", true);
    await mem(circleB1, users.twoCircle, "family", true);

    // one check-in per visibility in circle A1, recorded by the coordinator
    // as a proxy EXCEPT the "elder_self" one; plus one proxy coordinator-tier.
    const checkins: Record<string, string> = {};
    const addCheckin = async (
      key: string, visibility: string, recorder: string, isProxy: boolean,
    ) => {
      const id = randomUUID();
      await c.query(
        `insert into public.checkins (id,circle_id,occurred_on,mood,spoken_lang,visibility,recorded_by,is_proxy,created_via)
         values ($1,$2,current_date,'ok','ar',$3,$4,$5,'demo')`,
        [id, circleA1, visibility, recorder, isProxy],
      );
      await c.query(
        `insert into public.checkin_content (checkin_id,circle_id,visibility,recorded_by,is_proxy,transcript,translation)
         values ($1,$2,$3,$4,$5,'words','words')`,
        [id, circleA1, visibility, recorder, isProxy],
      );
      checkins[key] = id;
    };
    await addCheckin("A1_circle", "circle", users.A1_coordinator, true);
    await addCheckin("A1_family", "family", users.A1_coordinator, true);
    await addCheckin("A1_coordinator", "coordinator", users.A1_coordinator, true);
    await addCheckin("A1_moodonly", "mood_only", users.A1_coordinator, true);
    await addCheckin("A1_elder_self", "family", users.A1_elder, false);

    return { orgA, orgB, circleA1, circleA2, circleB1, users, checkins };
  } finally {
    await c.end();
  }
}
```

- [ ] **Step 3: Write the smoke test**

Create `server/test/db/smoke.test.ts`:
```ts
import { beforeAll, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

test("fixture builds and a member reads their own circle", async () => {
  const rows = await asUser(fx.users.A1_coordinator, (c) =>
    c.query("select id from public.circles where id = $1", [fx.circleA1]),
  );
  expect(rows.rowCount).toBe(1);
});
```

- [ ] **Step 4: Run it**

Run:
```bash
npx supabase start
npx supabase db reset
npm --prefix server run test:db -- smoke
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add server/test/db/clients.ts server/test/db/fixture.ts server/test/db/smoke.test.ts
git commit -m "test(1a): DB test harness — raw/asUser/postgrest clients + fixture"
```

---

## Task 18: Test — tenant `SELECT` isolation matrix

**Files:**
- Create: `server/test/db/select-matrix.test.ts`

**Interfaces:**
- Consumes: `loadFixture`, `asUser`, `rawNoClaims`.

- [ ] **Step 1: Write the test**

Create `server/test/db/select-matrix.test.ts`:
```ts
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser, rawNoClaims } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("tenant SELECT isolation", () => {
  test("a member sees rows for their circle only", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select circle_id from public.checkins"),
    );
    expect(r.rows.every((x) => x.circle_id === fx.circleA1)).toBe(true);
    expect(r.rowCount).toBeGreaterThan(0);
  });

  test("an org-A member sees nothing in an org-B circle", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select * from public.circles where id = $1", [fx.circleB1]),
    );
    expect(r.rowCount).toBe(0);
  });

  test("the two-circle viewer sees BOTH circles via RLS (scope is per-membership)", async () => {
    const r = await asUser(fx.users.twoCircle, (c) =>
      c.query("select id from public.circles order by name"),
    );
    expect(r.rows.map((x) => x.id).sort()).toEqual([fx.circleA2, fx.circleB1].sort());
  });

  test("no claims set -> zero rows on every tenant table", async () => {
    const c = await rawNoClaims();
    try {
      for (const t of ["profiles","organizations","circles","circle_members",
        "invites","checkins","checkin_content","shifts","routine_items",
        "completions","adhoc_tasks"]) {
        const r = await c.query(`select * from public.${t}`);
        expect(r.rowCount, t).toBe(0);
      }
    } finally { await c.end(); }
  });

  // (a soft-removed member seeing nothing is exercised with a committed
  // removal in write-matrix.test.ts — it cannot be observed inside asUser's
  // rolled-back transaction.)
});
```

- [ ] **Step 2: Run and commit**

```bash
npm --prefix server run test:db -- select-matrix
git add server/test/db/select-matrix.test.ts
git commit -m "test(1a): tenant SELECT isolation matrix"
```
Expected: all tests pass.

---

## Task 19: Test — `checkin_content` consent-tier matrix + base-table-direct

**Files:**
- Create: `server/test/db/checkin-content.test.ts`

**Interfaces:**
- Consumes: `loadFixture`, `asUser`.

- [ ] **Step 1: Write the test**

Create `server/test/db/checkin-content.test.ts`:
```ts
import { beforeAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

/** does `user` get the content row for check-in `key`? */
async function canSeeContent(user: string, key: string): Promise<boolean> {
  const r = await asUser(fx.users[user], (c) =>
    c.query("select checkin_id from public.checkin_content where checkin_id = $1",
      [fx.checkins[key]]),
  );
  return r.rowCount === 1;
}

describe("consent-tier matrix (proxy check-ins recorded by the coordinator)", () => {
  // circle: everyone in the circle
  test("circle -> hired caregiver YES", async () => {
    expect(await canSeeContent("A1_caregiver_hired", "A1_circle")).toBe(true);
  });
  // family: coordinator OR is_family_member OR recorder
  test("family -> family member YES", async () => {
    expect(await canSeeContent("A1_family", "A1_family")).toBe(true);
  });
  test("family -> hired caregiver NO", async () => {
    expect(await canSeeContent("A1_caregiver_hired", "A1_family")).toBe(false);
  });
  test("family -> the elder NO (proxy coordinator-recorded, family tier, elder is is_family) YES", async () => {
    // elder IS is_family_member in A1 -> family tier admits her
    expect(await canSeeContent("A1_elder", "A1_family")).toBe(true);
  });
  // coordinator: coordinator OR recorder
  test("coordinator -> coordinator YES", async () => {
    expect(await canSeeContent("A1_coordinator", "A1_coordinator")).toBe(true);
  });
  test("coordinator -> family member NO", async () => {
    expect(await canSeeContent("A1_family", "A1_coordinator")).toBe(false);
  });
  test("coordinator -> the elder NO (proxy, coordinator tier)", async () => {
    expect(await canSeeContent("A1_elder", "A1_coordinator")).toBe(false);
  });
  // mood_only: only the recorder
  test("mood_only -> coordinator (the recorder) YES", async () => {
    expect(await canSeeContent("A1_coordinator", "A1_moodonly")).toBe(true);
  });
  test("mood_only -> everyone else NO", async () => {
    expect(await canSeeContent("A1_family", "A1_moodonly")).toBe(false);
    expect(await canSeeContent("A1_elder", "A1_moodonly")).toBe(false);
    expect(await canSeeContent("A1_caregiver_hired", "A1_moodonly")).toBe(false);
  });
  // the elder's own recording — always full
  test("elder self-recording -> the elder YES", async () => {
    expect(await canSeeContent("A1_elder", "A1_elder_self")).toBe(true);
  });
});

test("a member can read the parent checkins row but NOT the content", async () => {
  const parent = await asUser(fx.users.A1_caregiver_hired, (c) =>
    c.query("select id, mood from public.checkins where id = $1", [fx.checkins.A1_moodonly]),
  );
  expect(parent.rowCount).toBe(1);            // existence + mood are visible
  expect(await canSeeContent("A1_caregiver_hired", "A1_moodonly")).toBe(false);
});

test("checkins has no transcript column to leak", async () => {
  await expect(
    asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("select transcript from public.checkins limit 1")),
  ).rejects.toThrow(/column .*transcript.* does not exist/i);
});
```

- [ ] **Step 2: Run and commit**

```bash
npm --prefix server run test:db -- checkin-content
git add server/test/db/checkin-content.test.ts
git commit -m "test(1a): consent-tier matrix + base-table-direct"
```
Expected: all pass. If a tier test fails, fix migration 009's `case` expression — not the test.

---

## Task 20: Test — the §5 write matrix

**Files:**
- Create: `server/test/db/write-matrix.test.ts`

**Interfaces:**
- Consumes: `loadFixture`, `asUser`.

- [ ] **Step 1: Write the test**

Create `server/test/db/write-matrix.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser, asUserCommitted } from "./clients";

let fx: Fixture;
// beforeEach (not beforeAll): asUserCommitted tests leave state behind.
beforeEach(async () => { fx = await loadFixture(); });

const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow();
const allowed = (p: Promise<unknown>) => expect(p).resolves.toBeDefined();

describe("write matrix — role gating", () => {
  test("caregiver cannot INSERT a routine_item", () =>
    denied(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'x','09:00','{1,2}')`, [fx.circleA1]))));

  test("coordinator CAN INSERT a routine_item", () =>
    allowed(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'x','09:00','{1,2}')`, [fx.circleA1]))));

  test("family member cannot INSERT a completion", async () => {
    // seed a routine item as the coordinator (committed), then try as family
    const rid = await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'y','08:00','{1,2,3,4,5}') returning id`, [fx.circleA1]),
    ).then((r) => r.rows[0].id as string);
    await denied(asUser(fx.users.A1_family, (c) =>
      c.query(`insert into public.completions (circle_id,routine_item_id,on_date,done_by)
               values ($1,$2,current_date,$3)`, [fx.circleA1, rid, fx.users.A1_family])));
  });

  test("a non-elder cannot change a non-proxy check-in's visibility", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.checkins set visibility='circle' where id=$1`,
        [fx.checkins.A1_elder_self]))));

  test("the elder CAN change her own check-in's visibility", () =>
    allowed(asUser(fx.users.A1_elder, (c) =>
      c.query(`update public.checkins set visibility='circle' where id=$1`,
        [fx.checkins.A1_elder_self]))));

  test("circles cannot be INSERTed by app_authenticated (no policy)", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.circles (org_id,name,elder_name,timezone)
               values ($1,'z','Z','America/Toronto')`, [fx.orgA]))));

  test("circle_members cannot be INSERTed by app_authenticated (no policy)", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.circle_members (circle_id,user_id,role)
               values ($1,$2,'family')`, [fx.circleA1, fx.users.twoCircle]))));
});

describe("write matrix — column-scope triggers (committed state)", () => {
  async function seedShift(): Promise<string> {
    return asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(
        `insert into public.shifts (circle_id,starts_at,ends_at,caregiver_id)
         values ($1, now(), now() + interval '2 hours', $2) returning id`,
        [fx.circleA1, fx.users.A1_caregiver_hired],
      ),
    ).then((r) => r.rows[0].id as string);
  }

  test("assigned caregiver CAN set checked_in_at", async () => {
    const id = await seedShift();
    await allowed(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`update public.shifts set checked_in_at = now() where id = $1`, [id])));
  });

  test("caregiver setting checked_in_at AND caregiver_id is rejected by the trigger", async () => {
    const id = await seedShift();
    await denied(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(
        `update public.shifts set checked_in_at = now(), caregiver_id = $2 where id = $1`,
        [id, fx.users.A1_elder],
      )));
  });

  test("an unassigned caregiver cannot touch a shift at all (RLS)", async () => {
    const id = await seedShift();
    // reassign to nobody, committed
    await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`update public.shifts set caregiver_id = null where id = $1`, [id]));
    await denied(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`update public.shifts set checked_in_at = now() where id = $1`, [id])));
  });

  test("a removed_at UPDATE that also flips role is rejected", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at=now(), role='coordinator'
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_family]))));

  test("a coordinator CAN soft-remove a family member (removed_at only)", () =>
    allowed(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at=now()
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_family]))));

  test("a soft-removed member then sees nothing (committed removal, fresh read)", async () => {
    await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at = now()
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_caregiver_hired]));
    const r = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`select * from public.checkins where circle_id = $1`, [fx.circleA1]));
    expect(r.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npm --prefix server run test:db -- write-matrix
git add server/test/db/write-matrix.test.ts
git commit -m "test(1a): §5 write matrix — role gating + column-scope triggers (committed)"
```
Every case now asserts a real allow/deny. The committed-state cases reload the fixture per test.

---

## Task 21: Test — guard triggers (last-coordinator, immutability, `handle_new_user`)

**Files:**
- Create: `server/test/db/guards.test.ts`

**Interfaces:**
- Consumes: `admin`, `loadFixture`.
- Uses the **admin** client (real commits) so concurrency and cross-connection behaviour are observable.

- [ ] **Step 1: Write the test**

Create `server/test/db/guards.test.ts`:
```ts
import { beforeEach, describe, expect, test } from "vitest";
import { admin } from "./clients";
import { loadFixture, type Fixture } from "./fixture";
import { randomUUID } from "node:crypto";

let fx: Fixture;
beforeEach(async () => { fx = await loadFixture(); });

describe("last-coordinator / owner guard", () => {
  test("removing the only coordinator is rejected", async () => {
    const c = admin(); await c.connect();
    try {
      await expect(c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA1, fx.users.A1_coordinator],
      )).rejects.toThrow(/last coordinator/i);
    } finally { await c.end(); }
  });

  test("removing the org owner's membership is rejected", async () => {
    // A1_coordinator is orgA owner. Add a 2nd coordinator so 'last coordinator'
    // is not the blocker, then try to remove the owner.
    const c = admin(); await c.connect();
    try {
      await c.query(
        `insert into public.circle_members (circle_id,user_id,role) values ($1,$2,'coordinator')`,
        [fx.circleA1, fx.users.twoCircle],
      );
      await expect(c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA1, fx.users.A1_coordinator],
      )).rejects.toThrow(/organization owner/i);
    } finally { await c.end(); }
  });

  test("two concurrent self-removals cannot both succeed", async () => {
    const c0 = admin(); await c0.connect();
    await c0.query(`insert into public.circle_members (circle_id,user_id,role)
      values ($1,$2,'coordinator'),($1,$3,'coordinator')`,
      [fx.circleA1, fx.users.twoCircle, fx.users.A2_coordinator]);
    // now 3 coordinators: A1_coordinator (owner), twoCircle, A2_coordinator
    await c0.end();

    const a = admin(), b = admin();
    await a.connect(); await b.connect();
    try {
      await a.query("begin"); await b.query("begin");
      await a.query(`update public.circle_members set removed_at=now()
        where circle_id=$1 and user_id=$2`, [fx.circleA1, fx.users.twoCircle]);
      // b blocks on the FOR UPDATE lock until a commits
      const bPromise = b.query(`update public.circle_members set removed_at=now()
        where circle_id=$1 and user_id=$2`, [fx.circleA1, fx.users.A2_coordinator]);
      await a.query("commit");
      await bPromise;                     // now sees 2 coordinators, still ok
      await b.query("commit");
      // one more removal must now fail (only the owner left)
      const check = await a.query(`select count(*)::int n from public.circle_members
        where circle_id=$1 and role='coordinator' and removed_at is null`, [fx.circleA1]);
      expect(check.rows[0].n).toBe(1);
    } finally { await a.end(); await b.end(); }
  });
});

describe("immutability", () => {
  test("circle_id on a check-in is frozen", async () => {
    const c = admin(); await c.connect();
    try {
      await expect(c.query(
        `update public.checkins set circle_id=$1 where id=$2`,
        [fx.circleA2, fx.checkins.A1_circle],
      )).rejects.toThrow(/immutable/i);
    } finally { await c.end(); }
  });

  test("recorded_by on checkin_content is frozen", async () => {
    const c = admin(); await c.connect();
    try {
      await expect(c.query(
        `update public.checkin_content set recorded_by=$1 where checkin_id=$2`,
        [fx.users.A1_family, fx.checkins.A1_circle],
      )).rejects.toThrow(/immutable/i);
    } finally { await c.end(); }
  });
});

describe("handle_new_user full_name", () => {
  // full_name falls back to the email local-part (no '@') when metadata is
  // absent or blank, is truncated to 120 chars, and is otherwise stored verbatim.
  const cases: [string, unknown, RegExp][] = [
    ["absent", undefined, /^new-user-absent$/],
    ["empty", "", /^new-user-empty$/],
    ["huge", "x".repeat(10_000), /^x{120}$/],
    ["script", "<script>alert(1)</script>", /script/],  // stored literally, bounded
  ];
  for (const [label, meta, re] of cases) {
    test(`full_name (${label}) is non-null and <= 120 chars`, async () => {
      const c = admin(); await c.connect();
      try {
        const id = randomUUID();
        const raw = meta === undefined ? "{}" : JSON.stringify({ full_name: meta });
        await c.query(
          `insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
             created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
           values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             $2,'',now(),now(),'{}',$3::jsonb)`,
          [id, `new-user-${label}@example.com`, raw],
        );
        const r = await c.query(`select full_name from public.profiles where id=$1`, [id]);
        expect(r.rows[0].full_name).not.toBeNull();
        expect(r.rows[0].full_name.length).toBeLessThanOrEqual(120);
        expect(r.rows[0].full_name).toMatch(re);
      } finally { await c.end(); }
    });
  }
});
```

- [ ] **Step 2: Run and commit**

```bash
npm --prefix server run test:db -- guards
git add server/test/db/guards.test.ts
git commit -m "test(1a): guard triggers — last-coordinator, immutability, handle_new_user"
```

---

## Task 22: Test — bypass paths (claims leakage, PostgREST-direct, migration idempotency)

**Files:**
- Create: `server/test/db/bypass.test.ts`

**Interfaces:**
- Consumes: `rawNoClaims`, `mintJwt`, `postgrest`, `admin`, `loadFixture`.

- [ ] **Step 1: Write the test**

Create `server/test/db/bypass.test.ts`:
```ts
import { beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { loadFixture, type Fixture } from "./fixture";
import { rawNoClaims, mintJwt, postgrest } from "./clients";
import { Client } from "pg";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("connection-level claims are not sticky", () => {
  test("set claims in a txn, DISCARD ALL, next txn sees nothing", async () => {
    const c = new Client({
      connectionString:
        "postgresql://app_authenticated:app_authenticated@127.0.0.1:54122/postgres",
    });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: fx.users.A1_coordinator, role: "authenticated" }),
      ]);
      const seen = await c.query("select count(*)::int n from public.circles");
      expect(seen.rows[0].n).toBeGreaterThan(0);
      await c.query("commit");
      await c.query("discard all");
      // fresh txn, no claims -> auth.uid() null -> zero rows
      const after = await c.query("select count(*)::int n from public.circles");
      expect(after.rows[0].n).toBe(0);
    } finally { await c.end(); }
  });
});

describe("the browser cannot reach data through PostgREST", () => {
  test("anon key + a valid user JWT against /rest/v1/checkins -> 0 rows or 404", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "A1_coordinator@example.com" });
    const res = await postgrest("/rest/v1/checkins?select=*", jwt);
    // schema not exposed -> 404; or exposed-but-revoked -> 200 [] ; never data
    if (res.status === 200) {
      expect(await res.json()).toEqual([]);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  test("same for checkin_content and circle_members", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "x@example.com" });
    for (const t of ["checkin_content", "circle_members"]) {
      const res = await postgrest(`/rest/v1/${t}?select=*`, jwt);
      if (res.status === 200) expect(await res.json()).toEqual([]);
      else expect([401, 403, 404]).toContain(res.status);
    }
  });
});

describe("migrations are idempotent", () => {
  // db reset re-applies every migration; two runs prove no migration breaks on
  // a non-empty DB. Each run is ~15-30s, so this test needs a longer timeout.
  test("db reset twice in a row succeeds", () => {
    execFileSync("npx", ["supabase", "db", "reset"], { stdio: "pipe" });
    execFileSync("npx", ["supabase", "db", "reset"], { stdio: "pipe" });
  }, 180_000);
});
```

- [ ] **Step 2: Run and commit**

```bash
npm --prefix server run test:db -- bypass
git add server/test/db/bypass.test.ts
git commit -m "test(1a): bypass paths — claims leakage, PostgREST-direct, idempotency"
```

---

## Task 23: CI — GitHub Actions workflow for the DB suite

**Files:**
- Create: `.github/workflows/db.yml`

**Interfaces:**
- Produces: on every PR and push touching `supabase/**` or `server/**`, spin up Supabase, apply migrations twice, run the DB test suite.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/db.yml`:
```yaml
name: db

on:
  pull_request:
    paths: ["supabase/**", "server/**", ".github/workflows/db.yml"]
  push:
    branches: [main]
    paths: ["supabase/**", "server/**"]

jobs:
  rls-suite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start
      - name: Apply migrations twice (idempotency)
        run: |
          supabase db reset
          supabase db reset
      - run: npm --prefix server ci
      - run: npm --prefix server run test:db
      - if: always()
        run: supabase stop
```

- [ ] **Step 2: Verify locally with `act` or by pushing a branch**

Push the branch and confirm the `db` check runs green on the PR. If `supabase/setup-cli` cannot find a lockfile, ensure `server/package-lock.json` is committed (it is, from Task 1).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/db.yml
git commit -m "ci(1a): run the RLS/consent/write-matrix suite on every PR"
```

---

## Self-Review

**1. Spec coverage (§4, §5, schema parts of §11):**

| Spec element | Task |
|---|---|
| Enums (§4) | 2 |
| `profiles` + safe `full_name` (§4, S8) | 3, 5, 21 |
| `organizations` / `circles` + one-elder unique (§4) | 3 |
| `circle_members` / `invites` + partial uniques (§4, S3) | 4 |
| `handle_new_user()` / `updated_at` (§4) | 5 |
| `checkins` / `checkin_content` denormalized+frozen (§4, D12) | 6, 14 |
| `shifts` CHECKs (§4, S11) | 6 |
| `routine_items` effective_from + weekdays CHECK; `completions` composite FK (§4, S10/S11) | 7 |
| Indexes incl. `circle_members` partial (§4, S11) | 3, 4, 6, 7 |
| Helper functions owned by BYPASSRLS role, STABLE, `search_path=''` (§5, D14) | 8 |
| ENABLE+FORCE on all tables (§5) | 9 |
| Membership SELECT + `organizations` staff-visible (§5, C8) | 9 |
| Single combined `checkin_content` tier policy (§5, C1, C6) | 10 |
| Write policies, all `TO app_authenticated` (§5, D13) | 11, 12, 13 |
| Column immutability / caregiver+removed_at column scope (§5, C7, D15) | 14 |
| Last-coordinator / owner guard w/ FOR UPDATE (§5, C9) | 15 |
| REVOKE anon/authenticated; exposed schema pinned (§3, D13) | 1, 16 |
| RLS SELECT matrix + multi-circle viewer + no-claims (§11) | 18 |
| Consent-tier matrix + base-table-direct (§11) | 19 |
| Write matrix ~15 cases (§11) | 20 |
| Guard/trigger tests incl. concurrent removal, `handle_new_user` edges (§11) | 21 |
| Claims leakage; PostgREST-direct; migration idempotency (§11) | 22 |
| CI (§10, §11) | 23 |

No gaps.

**2. Placeholder scan:** No `TODO` / `similarly` / `etc.` in any code block. Cases in Tasks 20–21 that cannot commit inside `asUser` are explicitly named and delegated to the 1b integration test, not left vague.

**3. Type consistency:** `Fixture` shape defined in Task 17 (`fixture.ts`) is consumed unchanged in Tasks 18–22. `asUser(userId, fn)`, `rawNoClaims()`, `mintJwt({sub,email})`, `postgrest(path, jwt)` signatures are used consistently. Migration filenames match the File Structure table.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-amanah-mvp-1a-schema-rls.md`. This is **Part 1a of 3** — do not start 1b until 1a's CI is green.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

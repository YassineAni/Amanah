# Handoff — Part 1a complete, starting Part 1b

## Repo / branch / commit

- **Repo:** `C:\Users\yanid\Amanah` (GitHub `github.com/YassineAni/her-day`, not yet renamed)
- **Branch:** `feat/multi-tenant-mvp` — 44 commits ahead of `main` (`6ddf840`)
- **HEAD:** `af9d73d` — `fix(1a): final-review wave …`
- **Not merged.** See "Merge status" below.
- **Untracked / unrelated:** `docs/Her-Day-Pitch.pdf` (deleted), `docs/guardrails.md` (modified), `docs/amanah1.png`, root `package-lock.json` — pre-existing, **not ours**, left untouched throughout. Do not stage them.

## Authoritative docs (read these; do not duplicate)

| Doc | What it is |
|---|---|
| `docs/superpowers/specs/2026-09-08-amanah-multi-tenant-mvp-design.md` | **The spec.** Binding authority. §3 architecture/`withUserTxn`, §4 data model, §5 authorization/RLS, §6 auth+onboarding, §7 API surface, §8 domain modules, §11 testing, §13 frontend-wiring constraint, §14 decisions log (D1–D20). |
| `docs/superpowers/specs/2026-09-08-amanah-multi-tenant-mvp-review.md` | The 3-way review that shaped spec revision 2. |
| `docs/superpowers/plans/2026-09-08-amanah-mvp-1a-schema-rls.md` | The 1a plan (executed). |
| `docs/superpowers/plans/2026-09-08-amanah-mvp-1b-api.md` | **The 1b plan — your work.** 23 tasks. |
| `docs/superpowers/plans/2026-09-08-amanah-mvp-1c-storage-frontend-deploy.md` | 1c (later). |
| `.superpowers/sdd/2026-09-08-amanah-mvp-1a-schema-rls/` (git-ignored) | 1a execution ledger + per-task reports + `final-review.md` + `fix-wave-1-report.md` + `fix-wave-1-rereview.md`. May be deleted after merge. |

## What Part 1a implemented (verified)

A multi-tenant Postgres schema on Supabase with **RLS as the real authorization boundary**, plus a test suite that proves it by connecting as the actual restricted role with real JWTs.

- **16 migrations** `supabase/migrations/2026090800000{1..16}_*.sql`, applied by `supabase db reset`:
  - 001 extensions (`pgcrypto`, `citext`), 6 enums, schema `app`, role **`app_authenticated`** (LOGIN, NO `BYPASSRLS`).
  - 002–006 tables: `profiles` (= `auth.users.id`), `organizations`, `circles`, `circle_members`, `invites`, `checkins`, **`checkin_content`** (1:1 child holding words+audio, with frozen denormalized `circle_id`/`visibility`/`recorded_by`/`is_proxy`), `shifts`, `routine_items`, `completions`, `adhoc_tasks`. All partial-unique indexes + the load-bearing `circle_members (user_id, circle_id) WHERE removed_at IS NULL`.
  - 004 `handle_new_user()` trigger (populates `profiles` on `auth.users` insert; safe bounded `full_name`), `set_updated_at()`.
  - 007 RLS helpers `app.is_member` / `circle_role` / `is_family` / `is_org_owner` — `SECURITY DEFINER`, owner `postgres`, `STABLE`, `search_path=''`.
  - 008 `ENABLE` + **`FORCE`** RLS on all 11 tenant tables; `SELECT` policies; `upd_profiles` (own row only); `sel_invites` (**coordinator-only**).
  - 009 the single combined `checkin_content` consent-tier `SELECT` policy.
  - 010–012 write policies (every one `TO app_authenticated`), all `USING` clauses membership-gated.
  - 013 immutability + column-scope triggers (allow-list style) + `checkin_content_denorm` + `propagate_checkin_visibility` + elder-consistency (both `circles` and `circle_members`).
  - 014 `guard_member_removal` (last-coordinator / owner, `SECURITY DEFINER`, `SELECT … FOR UPDATE` on the circle row).
  - 015 `REVOKE ALL` in `public` from `anon`/`authenticated`; explicit grants to `app_authenticated`.
  - 016 `GRANT … ON SCHEMA auth TO app_authenticated` — **a documented no-op** (see invariant #7).
- **Test harness + suite** `server/test/db/`:
  - `clients.ts` — `admin()` (postgres/BYPASSRLS, unconnected), `rawNoClaims()` (app_authenticated, no claims), `asUser(id, fn)` (txn, ROLLBACK), `asUserCommitted(id, fn)` (txn, COMMIT), `rawAsUser(id)` (open app_authenticated txn returned to caller — for multi-session tests), `mintJwt`, `postgrest`, `ANON_KEY` (resolved at load via `npx supabase status -o env`).
  - `fixture.ts` — `loadFixture(): Promise<Fixture>`. Truncates tenant tables, deletes `%@example.com` auth users, rebuilds: 2 orgs, 3 circles (A1/A2 in orgA, B1 in orgB), a `role × is_family` user matrix incl. **`A2_elder_notfamily`** (elder with `is_family_member=false`), check-ins per visibility in A1/A2/B1, and ≥1 row per tenant table in ≥2 circles. `Fixture` = `{ orgA, orgB, circleA1, circleA2, circleB1, users, checkins, shifts, routineItems, completions, adhocTasks, invites }` (all `Record<string,string>` of label→uuid).
  - Suites: `smoke`, `select-matrix` (tenant isolation + fail-closed), `checkin-content` (consent-tier matrix + base-table-direct), `write-matrix` (§5 writes), `delete-matrix` (removed-member cannot write — the C1 regression guard), `guards` (last-coordinator incl. a real 2-session lock-contention test, immutability, `handle_new_user` edges), `bypass` (claims non-stickiness, PostgREST-direct, migration idempotency).
- **CI** `.github/workflows/db.yml` — on PR / push to `main` touching `supabase/**` or `server/**`: `supabase/setup-cli`, `supabase start`, `db reset` ×2, `npm --prefix server ci`, `npm --prefix server run test:db`. **Not yet observed green on a real GHA run** (assumption: it will pass — mirrors local).

## Security invariants — do not regress these

1. **Every RLS policy targets `TO app_authenticated`** — never `authenticated`/`public`. A policy on the wrong role silently does nothing under `FORCE RLS`. (spec §5, D13)
2. **`FORCE ROW LEVEL SECURITY` on every tenant table.** `app_authenticated` has no `BYPASSRLS`; the API pool logs in as it.
3. **The only way to query as a user is `withUserTxn(claims, fn)`** (1b builds it): one `BEGIN…COMMIT`, `select set_config('request.jwt.claims', $1, true)` with `$1` **bound** (never interpolated — the claims JSON carries user-controlled `name`/`email`), `DISCARD ALL` on release. Connection must be **direct (5432), not the transaction pooler**. (spec §3, C3, D20). `bypass.test.ts` proves claims don't survive `DISCARD ALL`.
4. **`checkin_content` redaction is a real child table with its own single tier policy** — a non-permitted viewer gets **zero rows**, not a nulled column. `checkins` (existence + mood) is member-readable; words/audio live only in `checkin_content`. `checkins` has no `transcript` column. (spec §5, D12, C1)
5. **Every write-policy `USING`/`WITH CHECK` is membership-gated.** Identity branches (`recorded_by`/`caregiver_id`/`added_by` = `auth.uid()`) are always wrapped in `app.is_member(circle_id) and (…)` — because a no-`WHERE` DELETE/UPDATE needs no read access, so only `USING` applies. (final-review C1 — a removed member deleted 8 rows before this fix.) INSERT `WITH CHECK` binds attribution to `auth.uid()` on `checkins`, `completions`, `adhoc_tasks`.
6. **No INSERT policy on `circles`/`organizations`/`circle_members`; no DELETE on `circle_members`.** Those operations are for the `service_role`/admin pool only (onboarding, invite accept). The absence *is* the lock.
7. **`app_authenticated` cannot resolve `auth.uid()` from a plain (`SECURITY INVOKER`) plpgsql body** — it has no `USAGE` on schema `auth`, and migration 016's grant is a no-op (the migration role, `postgres`, doesn't own `auth`; `grant authenticated to app_authenticated` was rejected — it carries `storage.*` SELECT). **1a's own `app.*` functions that touch `auth.*` are all `SECURITY DEFINER`.** → **1b rule: any plpgsql function/trigger body that calls `auth.uid()`/`auth.jwt()`/`auth.email()` MUST be `SECURITY DEFINER` (owner `postgres`), `search_path=''`, fully schema-qualified.** RLS *policy expressions* referencing `auth.uid()` are fine (resolved at `CREATE POLICY` time).
8. **Column-scope triggers are allow-lists** — they raise unless *only* the permitted columns (+`updated_at`) differ. `checkins` UPDATE: `visibility` only. `circle_members` UPDATE: `removed_at` only. `shifts` UPDATE by a non-coordinator: `checked_in_at`/`checked_out_at` only. They carry an `if (select auth.uid()) is null then return new` admin-path exemption — unreachable by a real user (policies deny first). **Caveat (NEW-2):** the lists are hand-enumerated, not structural — if 1b adds a column to these tables, re-check the enumeration.
9. **PostgREST exposes only `graphql_public`** (`config.toml [api].schemas`), and `auto_expose_new_tables = false`. The browser's anon key + user JWT cannot reach `public` tables — `bypass.test.ts` confirms.
10. **`config.toml` local ports are remapped `543xx → 541xx`** on the dev machine (Windows `winnat` reserves `54312–54411`). Local DB `127.0.0.1:54122`, API `54121`. CI/prod uses defaults — this is a local-only choice (D-log addendum in the plan).

## Test commands + setup

**Setup (once per machine):**
- Docker Desktop running (Windows: needs WSL2 healthy — a broken WSL was the first blocker; `wsl --status` must work).
- Supabase CLI via `npx supabase` (do **not** add to `package.json`).
- `npm --prefix server ci` (installs `pg`, `jose`, `vitest`).
- `npx supabase start` (first run pulls ~10 images; leave it running).
- `psql` is **not** on PATH — use `docker exec -i supabase_db_Amanah psql -U postgres -d postgres -c "…"` (or `-U app_authenticated`, password `app_authenticated`).

**Run:**
```
npx supabase db reset                        # re-apply all 16 migrations
npm --prefix server run test:db              # the whole DB suite
npm --prefix server run test:db -- guards    # one file
```

**Last verified result (commit `af9d73d`, 2026-09-10):**
`Test Files 7 passed (7) / Tests 61 passed (61)`, ~89 s (incl. the in-suite double `db reset`). Full suite run **twice** consecutively — no cross-file contamination. `guards` concurrency test stable over 5 runs and confirmed load-bearing (it *fails* if migration 014's `SECURITY DEFINER` is reverted). `npx supabase db reset` clean through `20260908000016`.

## Bugs found during 1a execution (both fixed + verified)

1. **`assert_elder_consistency` referenced a non-existent column** (`new.circle_id` on a trigger bound to `public.circles`, whose PK is `id`). plpgsql bodies aren't validated at `CREATE`, so `db reset` passed while the trigger hard-errored at runtime on every `elder_user_id` update. Fixed to `new.id` (commit `532d7e7` plan-sync, in migration `…013`).
2. **Three column-scope trigger functions lacked `SECURITY DEFINER`** (`checkins_column_scope`, `shifts_column_scope`, `circle_members_column_scope`). They call `auth.uid()` in the body; `app_authenticated` can't reach schema `auth` → **every real user's UPDATE on `checkins`/`shifts`/`circle_members` would have raised `42501` in production.** Missed by 13 migration reviews because those verifications ran as the `postgres` superuser. Caught by `write-matrix.test.ts` (first suite to connect as `app_authenticated`). Fixed: added `SECURITY DEFINER` (commit `44a3b3b`). This is the origin of invariant #7.

## Final adversarial review (opus, ran live exploits) — `final-review.md`

3 Critical + 12 Should-fix. Fix wave `af9d73d` addressed **C1, C2, C3, S1, S2, S4, S5, S6, S7, S8** — all re-verified ADDRESSED on the live stack (`fix-wave-1-rereview.md`):

- **C1** — removed-member could DELETE/UPDATE another circle's rows (reviewer deleted 8). Fixed by membership-gating 6 `USING` clauses (invariant #5). `delete-matrix.test.ts` is the regression guard.
- **C2** — the last-coordinator `FOR UPDATE` lock was a silent no-op (guard not `SECURITY DEFINER` → the lock query was RLS-filtered to 0 rows). Fixed + a real 2-session `guards` test proves contention (`could not obtain lock on row in relation "circles"`).
- **C3** — the headline isolation test passed with RLS off (fixture seeded only circle A1). Fixed: all 11 tables seeded in ≥2 circles; test asserts `rowCount>0` + own-circle-only + no other-circle rows.
- **S1/S2/S4/S5/S6/S7/S8** — visibility-propagation trigger; `upd_checkins` tests admission not tier-name; missing `upd_profiles` policy added; column-scope → allow-lists (froze `created_at`/`joined_at`); elder-consistency on `circle_members`; `sel_invites` coordinator-only; attribution binding on completions/adhoc.

### Unresolved / carried forward

- **NEW-1 (Important, non-blocking, → 1b's first task):** `upd_profiles` ships with **no column scope**. A user can currently rewrite their own `email` (to *another user's* exact address — only the PK, no unique index), `full_name` (surfaced in coordinator UI via §8 `doneByName`), `created_at`; `handle_new_user` is INSERT-only so the `auth.users` divergence is permanent. **Verified nothing in 1a reads `profiles.email` in a policy/body**, and `circle_members` has no `app_authenticated` INSERT/DELETE policy, so the spoof reaches nothing *today*. **Fix in 1b:** add `app.profiles_column_scope()` (`BEFORE UPDATE`, allow-list: only `ui_lang`, `tos_accepted_at`, `privacy_notice_version`, `updated_at` may differ) at the same time you wire `PATCH /api/me` / `POST /api/me/accept-notice`. ~12 lines; a sketch is in `fix-wave-1-rereview.md`.
- **S3 (invariant #7)** — resolved as a *constraint*, not a migration. Add to the 1b plan's Global Constraints.
- **Parked (not blocking, listed for the merge decision):** S9/S10/S12 (tighten `denied()`/`allowed()` assertions to expect a specific error), S11 (broader negative-test coverage — invites/organizations/profiles policy tests, full `role×is_family` matrix), N-items (dead `app.is_org_owner`; misleading "immutable by default" comment on the column-scope triggers per NEW-2; `bypass.test.ts` duplicates CI's `db reset`, ~65 s; S6 trigger covers soft-remove only — NEW-3, admin-recoverable). None are auth/consent holes.

## Merge status

**1a is functionally complete and, per the adversarial re-review, safe to merge as the DB foundation for 1b.** It has **not** been merged (merging to a shared branch requires the human's go-ahead). Suite green at `af9d73d`. Recommended before/at merge: land NEW-1 as one more commit on this branch (it's small and 1b will immediately expose the surface).

## Part 1b — scope + first steps

**Plan:** `docs/superpowers/plans/2026-09-08-amanah-mvp-1b-api.md` (23 tasks). Goal: port the single-tenant Express API onto this schema.

**Add to the 1b plan's Global Constraints before starting:**
- Invariant #7 verbatim: any plpgsql body calling `auth.*` must be `SECURITY DEFINER`/`search_path=''`/qualified.
- NEW-1: `app.profiles_column_scope()` allow-list trigger, built alongside the `profiles`-UPDATE endpoint.
- NEW-2: when 1b adds columns to `checkins`/`shifts`/`circle_members`, extend the migration-013 column-scope allow-list enumerations.

**First steps (1b Tasks 1–5 as planned):**
1. `server/src/config.ts` — typed env (`DATABASE_URL` **direct 5432**, `DATABASE_URL_ADMIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`).
2. `server/src/db/pool.ts` — `appPool` / `adminPool` + **`withUserTxn`** (invariant #3) + `withAdminTxn`. Reuse the `bypass.test.ts` claims-non-stickiness assertion against the real impl.
3. `server/src/auth/verify.ts` — verify the Supabase JWT (JWKS, HS256 fallback for local).
4. `server/src/auth/middleware.ts` + `auth/circle.ts` — `requireAuth`, `requireNoticeAccepted`, `requireCircle(...roles)` (also filters `circle_id = :cid` — RLS is per-membership, not per-circle — spec §5/C5), `perUserThrottle`.
5. Express app factory + `GET /api/health`.

**Keep** `server/src/consent.ts` + `server/src/scan.ts` + current `server/src/types.ts` until 1c (the plan uses `consent.ts` as a differential-test oracle vs the RLS tier policy). Magic-link auth only; EN-only UI; clinical files + correlation callout + circle-switcher UI are **out** (D16).

**The `server/test/db/` harness is reusable** for 1b's DB-touching tests — `asUser` / `asUserCommitted` / `rawAsUser` / `loadFixture` all still apply; import them.

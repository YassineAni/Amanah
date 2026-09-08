# Amanah MVP Design Spec — Review Verdict

- **Date:** 2026-09-08
- **Reviews synthesised:** self-review (advisor model) · external review (Codex) · adversarial architecture agent (read the spec against the current `server/src/` code)
- **Spec under review:** `2026-09-08-amanah-multi-tenant-mvp-design.md` (commit `d742e5d`, branch `feat/multi-tenant-mvp`)

## Verdict

Sound foundation, **not ready to build from yet.** The architecture choice (keep Express, add Supabase), the tenancy hierarchy (D1–D5) and the RLS-first instinct (D6) are all right, and §6–§8 are close. But all three reviews landed independently on the same core problem: **the load-bearing security section (§5) states guarantees more strongly than the design enforces them.** The check-in consent boundary does not hold as written, and there are several adjacent ways a mistake would produce a silent cross-tenant or cross-consent-tier leak — which is the one failure the product cannot have.

This needs **one focused revision pass, not a rewrite.** Four sections need work: §5 (the enforcement mechanism), §3/§6 (auth plumbing + invite races), §4 (indexes, constraints, delete behaviour), §2 (scope). Then it is buildable.

The adversarial agent also put a realistic clock on the current "In" list: **6–8 weeks for one developer.** That alone is a reason to make the scope cuts below.

---

## Critical — must be fixed before the plan

### C1. The check-in view is not a security boundary

§5 keeps a `SELECT` policy of just `app.is_member(circle_id)` on the `checkins` base table and does column redaction in a `checkins_visible` view with `security_invoker = true`. A `security_invoker` view runs with the *caller's* privileges, so either the caller can read `transcript` on the base table directly (bypassing the view entirely — `SELECT transcript FROM checkins` returns unredacted words for every check-in in every circle the caller belongs to, at any visibility tier) or the caller can't read it and the view can't produce it for authorised viewers either. It is API convention, not enforcement. This directly negates D6.

**Fix — split the sensitive columns into a child table:**
`checkin_content (checkin_id uuid pk references checkins(id) on delete cascade, transcript, translation, audio_path)` with **one** RLS `SELECT` policy encoding the full §5 tier matrix (`circle` / `family` / `coordinator` / `mood_only` + `recorded_by = auth.uid()`). `checkins` stays member-readable (existence + mood — the care-signal needs it); content is protected by real row-level RLS; redaction becomes a `LEFT JOIN` that returns NULLs naturally. No view, no column-grant gymnastics, no bypass. Do **not** substitute a `SECURITY DEFINER` view — that just hides the tenant check in a `WHERE` clause, which is the posture D6 rejects. Ripples into §4, §5, §7 (`GET /checkins` left-joins content), §8 (transcribe writes the content row), §11.

### C2. The browser can bypass Express and hit Supabase PostgREST directly

The frontend holds a real Supabase user JWT in `localStorage`. That token works against `https://<project>.supabase.co/rest/v1/*` with no Express in the path. Today it happens to fail closed (policies target `app_authenticated`, the browser's JWT is `authenticated`, so under `FORCE ROW LEVEL SECURITY` nothing matches) — but that is an accident. One later policy written the standard Supabase way (`TO authenticated`) and "the API is the only way in" silently evaporates, taking the consent tiers with it.

**Fix:** the spec must state explicitly — `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`, pin PostgREST's exposed schema to something empty/internal, every policy targets `app_authenticated` only, and a test proves the anon key + a user JWT against `/rest/v1/checkins` returns 0 rows / 401.

### C3. The `request.jwt.claims` mechanism is under-specified and, as phrased, injectable

"Each request sets `request.jwt.claims`" hides three problems:
1. **Role targeting** — policies must be written `TO app_authenticated`. A dev copying the stock `TO authenticated` form → policies don't apply to the pool's role → with FORCE RLS and no matching policy, *every query returns nothing* and the app goes dark.
2. **Pooler / claims leakage** — `SET LOCAL` is only safe inside one explicit `BEGIN…COMMIT` on one connection that is `DISCARD ALL`'d on release. A non-transactional query, or plain `SET` instead of `SET LOCAL`, and the claims GUC persists on the pooled connection — **the next request runs as the previous user.** The spec doesn't say whether `DATABASE_URL` is the transaction pooler (6543) or a direct connection (5432), nor mandate the transaction wrapper.
3. **Injection** — `SET LOCAL` can't take a bind parameter, so the natural implementation string-interpolates the claims JSON (which contains user-controlled signup metadata: `name`, `email`) into SQL on the one connection that drives every policy.

**Fix:** rewrite the §3 mechanism to specify — a direct or session-pinned connection; a single mandatory `withUserTxn(claims, fn)` wrapper doing `BEGIN; select set_config('request.jwt.claims', $1, true); … ; COMMIT` with `$1` **bound** and `DISCARD ALL` on release; every policy `TO app_authenticated`; a test proving no stale claim survives across pooled requests.

### C4. `SECURITY DEFINER` helpers under `FORCE RLS` recurse or return zero rows

`FORCE ROW LEVEL SECURITY` removes the table-owner's RLS exemption. `circle_members`' own policy calls `app.is_member`, which queries `circle_members` — the policy re-enters itself. A `SECURITY DEFINER` function owned by the ordinary table owner does **not** escape this under FORCE RLS: infinite recursion (stack-depth error) or silently zero rows, across the entire policy set. The spec says the helpers are `SECURITY DEFINER` with a pinned `search_path` but never says **who owns them**.

**Fix:** state that `app.is_member` / `circle_role` / `is_family` / `is_org_owner` are owned by a role with `BYPASSRLS` (or use `SET LOCAL row_security = off` inside them), are `STABLE`, and are the single source of membership truth. Add a test that a policy-triggered call doesn't recurse.

### C5. RLS is membership-scoped, not circle-scoped

A user in two circles passes `app.is_member` for **both**. So §8's claim that `correlationCallout` "only ever receives one circle's rows (the DB query is RLS-scoped)" is **false** — without an explicit filter it sees every circle the caller belongs to, and aggregates moods across elders into a nonsense callout.

**Fix:** §5 — state plainly that RLS scopes to *circles-you're-a-member-of*, and every `/api/circles/:cid` query **must also** filter `circle_id = :cid`. §8 — `correlationCallout` takes a `circleId`, filters on it, and throws if rows span circles (defence in depth). §11 — the fixture needs a viewer in **two** circles (different orgs) and an attack case: that viewer hits `/api/circles/:A/care-signal` and must not see circle B's rows.

### C6. Permissive policies OR-combine — a baseline `is_member` policy defeats file/content visibility

§5 says every domain table gets a baseline `SELECT` policy `USING (app.is_member(circle_id))` **and** that `clinical_files` visibility is "encoded directly in the SELECT policy". Two `PERMISSIVE` policies (the default) are OR'd: `is_member` alone lets anyone through and the visibility clause restricts nothing. Same trap for `checkin_content`.

**Fix:** tables with a visibility model (`clinical_files`, `checkin_content`) get **exactly one** `SELECT` policy that is the full combined condition (`membership AND visibility`), or use `RESTRICTIVE` policies to layer. State the choice. No blanket `is_member` `SELECT` policy on those two tables.

### C7. Write policies need column-level immutability and cross-table integrity

RLS `WITH CHECK` gates *which rows* you may write, not *which columns changed*:
- A caregiver allowed to `UPDATE` `shifts.checked_in_at/out` can rewrite `caregiver_id`, `coordinator_note`, `activity_tags` in the same statement.
- The coordinator `UPDATE` of `circle_members.removed_at` can also flip `role` (escalation) or `is_family_member`.
- `recorded_by`, `circle_id`, `uploaded_by`, `added_by`, `done_by` are mutable — an `UPDATE` could move a row to another circle or reassign attribution.
- `completions.routine_item_id` and `completions.circle_id` are independent FKs — nothing forces the routine item to belong to the completion's circle.

**Fix — add a "Column immutability & integrity" subsection to §5:** `BEFORE UPDATE` triggers asserting a `caregiver` update touches only `{checked_in_at, checked_out_at}` and a `removed_at` update touches only `{removed_at}`; `circle_id` and all `*_by` columns immutable after insert; composite FK `completions (routine_item_id, circle_id) REFERENCES routine_items (id, circle_id)` (needs `UNIQUE (id, circle_id)` on `routine_items`).

### C8. The `organizations` SELECT policy locks staff out of `/api/me`

Policy is `SELECT/UPDATE USING (owner_user_id = auth.uid())`. An invited caregiver or family member is not the owner, so they can't read the `organizations` row — but `/api/me` returns `is_demo`, which lives there. The demo badge silently disappears for everyone except the owner.

**Fix:** SELECT `USING (owner_user_id = auth.uid() OR EXISTS (SELECT 1 FROM circles c WHERE c.org_id = organizations.id AND app.is_member(c.id)))` (keep UPDATE owner-only), or denormalise `is_demo` onto `circles`.

### C9. "Cannot remove the last coordinator / the owner" cannot be an RLS predicate

It's an aggregate over the table being mutated, under concurrency: two coordinators each self-remove, both see `count = 2` under Read Committed, both commit → **zero coordinators, circle unmanageable.** The counting subquery also re-enters `circle_members`' policies.

**Fix:** a `BEFORE UPDATE` trigger that takes `SELECT … FOR UPDATE` on the `circles` row (serialising removals for that circle) then counts — or a `SERIALIZABLE` transaction in the handler. Same mechanism guards the owner's membership.

### C10. `audio_path` / `storage_path` are round-tripped through the client and never bound to the circle

`POST /checkins/transcribe` returns `audio_path` (`audio/<circle_id>/<uuid>`) to the browser; `POST /checkins` accepts `audio_path?` in the body; the INSERT policy checks `circle_id` membership but nothing checks the path's prefix. A member of circle A submits `POST /api/circles/A/checkins` with `audio_path = "<circleB>/<uuid>.webm"`; later `GET /checkins/:id/audio` reads the row (it's in circle A, visible) and asks `service_role` to sign a URL for circle B's object — **cross-circle audio disclosure with attacker input reaching the signing call.** Same shape for `clinical_files.storage_path`.

**Fix:** don't trust a client path. Either `transcribe` writes a pending `checkins` row server-side and returns its id, or `CHECK (audio_path IS NULL OR audio_path LIKE circle_id::text || '/%')` plus server-side validation on insert.

---

## Should fix

### S1. Law 25 / privacy posture over-claims

Both external reviewers rejected "pilots are free, so the privacy impact assessment waits for a paying agency." Québec Law 25 obligations attach to *building a system that processes personal information* and to *transfers outside Québec* — not to whether money changed hands; a signup checkbox does not discharge them. D10's "Law 25 data residency" is also imprecise — Law 25 requires a transfer *assessment*, not residency, and the audio goes to OpenAI (US) regardless of where the database sits.

**Fix:** §12 + D10 — reword. State: (a) DB / Auth / Storage in `ca-central-1` is a deliberate data-minimisation choice, not a compliance claim; (b) audio transcription transfers to OpenAI (US) — disclosed in the privacy notice, and needs a written transfer assessment before *any* real elder data, pilot included; (c) a **lightweight privacy assessment** (not the full formal PIA) is a **pre-pilot gate**. Drop the "checkbox replaces obligations" framing.

### S2. Elder consent lifecycle is undefined

- A coordinator can create a circle with no elder account — nothing records who authorised collecting the elder's data. Add an attestation to the create-circle step.
- No consent-withdrawal path. Define it: archive the circle, stop transcription, full delete on request.
- D8's "standard healthcare carve-out" for hiding `coordinator` files from the elder is asserted, not grounded — reword to a product decision with rationale; let a pilot family widen the tier per file.
- Contradiction: the elder can `PATCH` the visibility of a proxy `coordinator` / `mood_only` check-in she isn't allowed to read. Decide — she can only change visibility where she gets "full" (or `recorded_by = elder`). Put it in the §5 writes table.

### S3. Invite acceptance — races and dead-ends

- **Double-accept:** make the first statement a compare-and-swap — `UPDATE invites SET accepted_at = now() WHERE token = $1 AND accepted_at IS NULL RETURNING *`; no row → `410`.
- **Removed members can't rejoin:** `UNIQUE (circle_id, user_id)` isn't partial on `removed_at` — a soft-removed member is locked out forever. Make it `UNIQUE (circle_id, user_id) WHERE removed_at IS NULL`, and have accept clear `removed_at`.
- **Elder slot filled / already a member:** partial-unique / unique violations surface as 500s — need explicit `409`.
- **Email whitespace:** `citext` handles case, not surrounding spaces from a paste — `auth.email()` never has spaces, so the invite is permanently unacceptable with no feedback. Normalise (`lower(trim(...))`) and format-validate on invite insert.
- Add `UNIQUE (circle_id, email) WHERE accepted_at IS NULL` so one email can't accumulate 50 pending invites.

### S4. `GET /api/invites/:token` leaks PII, unauthenticated and unthrottled

Returns `{ circle_name, inviter_name, role, email }` to anyone with the token (which lands in email bodies, referer headers, logs). The `email` is gratuitous. **Fix:** drop `email` (or return `email_matches_session: bool` for authed callers); add an IP throttle.

### S5. `POST /api/tts` as a Public endpoint is a cost / DoS hole

Read-aloud only happens inside the signed-in app, yet the spec keeps `/api/tts` unauthenticated with a throttle keyed on the Authorization header — so all anonymous callers share **one** 60-per-5-min bucket: one attacker denies every real user *and* drives unbounded OpenAI spend within the limit. **Fix:** behind `requireAuth`, throttle per user id, keep a hard OpenAI spend cap. Remove it from the Public list (it contradicts "`anon` has no grants").

### S6. Dropping `GET /api/today` makes the elder's home screen expensive

The elder's phone needs a cheap "has she checked in today?" + today's date in her tz. Folding that into `GET /care-signal` forces her client to pull an 11-day strip with everyone's shifts and the coordinator's correlation analytics — wasteful and a mild privacy smell. **Fix:** keep a one-row `GET /api/circles/:cid/today → { today, has_checkin, last_mood }`.

### S7. Storage orphans hold PHI with no row, no RLS, no consent binding

`transcribe` uploads audio *before* `POST /checkins`. Abandon the flow and the object persists with no DB row — no RLS, no visibility tier, not covered by delete-cascade. Clinical-file uploads have the same shape. **Fix:** upload on save, not on transcribe (or a nightly sweep of bucket objects with no matching row). Confirm §12's "deleting a circle deletes Storage objects under that `circle_id`" is a real code path with a test — the FK cascade only covers rows.

### S8. `handle_new_user()` + `full_name text NOT NULL` breaks magic-link signup

The trigger runs inside the signup transaction. Magic-link signups often carry no `raw_user_meta_data.full_name` → `NOT NULL` violation → **the signup itself 500s.** `full_name` is also unbounded and unsanitised (client-set → stored → rendered in every coordinator's UI). **Fix:** `left(coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''), split_part(email,'@',1)), 120)`.

### S9. `POST /api/circles` is under-specified

No transaction mandate for the org+circle+member triple (partial failure → an orphan circle the caller can't delete — `circles` DELETE is `service_role` only). No creation cap. `timezone` is a free string "prefilled from `Intl`" — an invalid IANA name breaks every date derivation in `careSignal` / `plan`; validate server-side against a known tz set. Specify that the `org_id`-given ownership check runs *as the user* (RLS / parameterised query), not a `service_role` read + JS compare.

### S10. The `weekdayOf` timezone "fix" is mischaracterised and would regress

The weekday of a bare `YYYY-MM-DD` is timezone-independent — 2026-09-08 is a Tuesday everywhere. The current `new Date(date + 'T00:00:00').getDay()` is *correct* because the `T00:00:00` suffix forces local-midnight parsing. Adding a tz parameter is a no-op at best. The real tz work is in **date derivation**: `demoDay(offset)` must become "today-in-circle-tz ± offset", and `completions.on_date` / `adhoc_tasks.on_date` must be written using circle-tz "today". **Fix:** correct §8's description; keep `weekdayOf(dateString)` pure; put the tz logic in the care-signal window and the `on_date` writes; test the UTC date boundary with a circle in `America/Toronto` and the DST transition days (2 Nov 2025, 8 Mar 2026). Also add `effective_from` to `routine_items` (or state the limitation) so editing a routine item doesn't rewrite what past days appear to have contained.

### S11. Schema gaps — one grouped revision pass on §4

| Gap | Consequence | Fix |
|---|---|---|
| No indexes in §4 | Every RLS check seq-scans `circle_members` per policy evaluation | `CREATE INDEX ON circle_members (user_id, circle_id) WHERE removed_at IS NULL`; index `circle_id` on every domain table (Postgres doesn't auto-index FKs); `checkins (circle_id, occurred_on)`, `shifts (circle_id, starts_at)`, `invites (email)` |
| FK `ON DELETE` unspecified on `owner_user_id`, `elder_user_id`, `recorded_by`, `done_by`, `uploaded_by`, `added_by`, `invited_by`, `caregiver_id` | Deleting a profile fails with FK violation or orphans rows; §12 promises "how to delete" but user deletion is undesigned | Decide per column (`SET NULL` for `elder_user_id` / `caregiver_id`; `RESTRICT` or reassign for `*_by`); state that person-level deletion = remove memberships + null authored refs, or scope it out and fix the privacy notice |
| `activity_tags text[]` (was an enum) | No DB validation; typos silently drop out of `correlationCallout` and filters | `activity_tag` enum array, or `CHECK (activity_tags <@ ARRAY[...]::text[])` |
| `weekdays smallint[]` — no constraint | Junk values (`9`, `-1`, `[]`) accepted | `CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND array_length(weekdays,1) BETWEEN 1 AND 7)` |
| `ui_lang`, `created_via`, `spoken_lang`, `elder_lang` free `text` | Bad values reach Whisper / frontend | `CHECK (ui_lang IN ('en','fr'))`, `CHECK (created_via IN ('live','demo'))` |
| `shifts` — no `CHECK (ends_at > starts_at)`, no `checked_out_at ⇒ checked_in_at` | Inverted / nonsensical shifts | Add checks |
| No consent / ToS record | §12 promises a signup consent checkbox + privacy-notice version; nowhere to store it | `profiles.tos_accepted_at timestamptz`, `privacy_notice_version text` |
| Elder FK ↔ membership consistency | `circles.elder_user_id` and the `circle_members` elder row can desync | Trigger asserting they agree, or accept + test the risk |
| `size_bytes` no `CHECK (> 0)` / max | — | DB check |

### S12. Missing endpoints and operational pieces

- `POST /api/circles/:cid/shifts` and `DELETE /shifts/:id` (spec has `PATCH` only); `DELETE /api/circles/:cid` (referenced in §12's delete path, absent from §7).
- **Email provider is never named** (SES / Postmark / Resend) — real integration work hiding in "send an email". Recommend `supabase.auth.admin.inviteUserByEmail()` with circle + role in metadata (no new dependency). Record it in §6 / the decisions log.
- The nightly `pg_dump` has **no owner** (Fly cron? GitHub Action? Supabase scheduled function?), **no restore test**, and does **not** cover the `audio` / `files` Storage buckets. Fix all three.

### S13. The frontend has no design in the spec

§2 lists "frontend wired to the new API + auth, deployed" and §10 says where it hosts — but none of the 14 sections cover auth screens, how circle context threads through the app, or what changes in `api.ts`. That is ~a third of the work (1c) with zero design. Either add a section or split 1c into its own spec. It must also state the standing constraint (`preserve-frontend-when-wiring`): the existing frontend is connected to the backend **without changing its visuals**, a wiring map is delivered first, and no visual change is made without asking.

### S14. The test plan misses the tests that would catch C1–C10

Add: (a) query `checkins` / `checkin_content` **base tables directly as `app_authenticated`** — assert redaction holds / grants absent (catches C1); (b) a connection with **no `request.jwt.claims`** → `SELECT *` on every table returns 0 rows; (c) **claims leakage** — request A (circle 1, user X) then request B (circle 2, user Y) on a 1-connection pool → no stale `auth.uid()` / rows; (d) **PostgREST direct** — user JWT against `/rest/v1/*` → 0 rows; (e) **`service_role` handler authz** — `POST /api/circles` with someone else's `org_id` → 403; upload to a circle you're not in → 403; (f) **`audio_path` tampering** per C10; (g) **invite double-accept** → exactly one membership; (h) `handle_new_user()` with empty / 10k-char / `<script>` / absent `full_name`; (i) the **§5 writes matrix** (~15 rows — caregiver INSERTs a routine item → denied; family toggles a completion → denied; non-elder UPDATEs a non-proxy check-in → denied; unassigned caregiver sets `checked_in_at` → denied); (j) migration idempotency (`supabase db push` twice on a non-empty DB); (k) `EXPLAIN` on a policy-heavy query confirms the `circle_members` index is used.

---

## Nice to have

- Mark `app.is_member` / `circle_role` / `is_family` / `is_org_owner` `STABLE`.
- Add a **"Pilot acceptance criteria"** section with measurable outcomes: nightly check-in completion rate, whether coordinators act on the signal, whether care decisions change. The pilot exists to test these — name them.
- No `updated_at` on any table — a cheap win for the polling frontend.
- No expired-invite cleanup job.
- `expandDay`'s sort is unstable for equal `time_of_day` — add a tie-break.
- No per-check-in spoken-language override: `elder_lang` defaults to `'ar'`; if she speaks French one night, Whisper gets the wrong hint before `POST /checkins` can correct it. Allow the client to pass `spoken_lang` to `transcribe`.
- `POST /checkins/transcribe`'s `demoUtteranceId` path should verify `circles.is_demo`.
- State the threat-model boundary in §3: RLS protects against API *logic* bugs, not process compromise — the Express process holds both the `app_authenticated` and `service_role` pools, so an RCE / SSRF there is game-over regardless of RLS. That is the accepted MVP boundary; name it.

---

## Scope — decisions for the product owner

All three reviews flagged the "In" list (~18 items, **6–8 weeks solo**) as too large for one qualitative demand signal. The loop being tested is: *elder records → coordinator sees it beside the schedule → care changes.* Recommended cuts, and where the reviewers agree or split:

| Candidate | Verdict | Detail |
|---|---|---|
| **Clinical files** (upload / scan / Storage / signed URL / `file_visibility` / half the §5 matrix / `scan.ts`) | **Cut — all three reviews.** Biggest single de-risk. | A whole second consent-gated Storage surface carrying the most sensitive content (capacity assessments). Pilots can email a PDF. |
| **Automated correlation callout** | **Defer — Codex + adversarial agent.** | The raw check-ins beside the schedule already make the point; the auto-suggestion is a nicety. Coordinator eyeballs the pattern. |
| **Shifts + visit check-in/out** | **Split.** Advisor: cut. Adversarial agent: **keep** — the check-ins-beside-shifts juxtaposition *is* the demo's differentiating moment; cutting it guts `care-signal` to a bare mood strip. | Recommendation: keep a **thin** shifts (assign + check-in/out, no correlation), because it carries the demo. |
| **Circle switcher / multi-circle UI** | **Defer — adversarial agent.** Schema (D1) stays future-proof with no migration cost; the switcher is Phase-2-adjacent (agency staff are already "Out"), and most pilot families have one elder. | |
| **Two auth methods** | **Consider magic-link only** — no password reset flow, no credential-handling surface. | |
| **French UI** | Advisor: defer until a Québec *agency* asks. Note: native-speaker *review* is already "Out"; this is about the extraction/translation *work*. | EN-only for pilot families is defensible. |

**My recommendation:** cut clinical files; defer the automated correlation callout (keep raw check-ins on the schedule strip); keep a thin shifts; defer the circle-switcher UI (keep the schema); magic-link-only auth; EN-only for the pilot. That roughly halves the build and removes the highest-risk data class.

---

## What happens next

1. **You decide:** (a) the scope cuts above — take my recommendation, or adjust; (b) adding a lightweight pre-pilot privacy assessment as a gated scope item (S1).
2. I apply C1–C10 and S1–S14 to the spec, re-run the self-review loop, and bring the revised spec back for your approval.
3. On approval, `superpowers:writing-plans` turns it into the 1a → 1b → 1c implementation plan. No implementation code before then.

---

## Revision 2 — resolution (2026-09-08)

**Decisions taken:** (a) recommended scope cut applied — clinical files, the automated correlation callout, the circle-switcher UI, password auth, and French UI are deferred to Phase 2; the multi-elder schema stays. (b) The lightweight pre-pilot privacy assessment is added as a hard gate.

**All findings actioned in the spec:**

| Finding | Where in revision 2 |
|---|---|
| C1 check-in boundary | §4 `checkin_content` table; §5 single combined SELECT policy; D12 |
| C2 PostgREST bypass | §3 REVOKE + pinned schema + test; §5 "Closing the direct-PostgREST path"; D13 |
| C3 claims mechanism | §3 `withUserTxn` (bound `$1`, direct connection, `DISCARD ALL`, `TO app_authenticated`); D20 |
| C4 helper ownership | §5 helpers owned by a BYPASSRLS role, `STABLE`; D14 |
| C5 membership ≠ circle scope | §5 statement; §7 per-handler `circle_id = :cid`; §8 `weekStrip(circleId)` assert; §11 multi-circle fixture + attack case |
| C6 permissive OR-combine | §5 "exactly one SELECT policy" for visibility tables |
| C7 column immutability + integrity | §5 trigger subsection; §4 `completions` composite FK + `routine_items UNIQUE (id, circle_id)` |
| C8 `organizations` locks out staff | §5 `organizations` SELECT policy with the `EXISTS` clause |
| C9 last-coordinator guard | §5 trigger + `SELECT … FOR UPDATE`; D15 |
| C10 `audio_path` binding | §7/§9 staging-path prefix check + move; `checkin_content.audio_path` CHECK |
| S1 Law 25 posture | §12 rewrite; D10 reworded; D19 |
| S2 elder consent lifecycle | §6 privacy-notice accept + attestation; §12 withdrawal path; D8 reworded; §5 elder visibility-PATCH limit |
| S3 invite races | §6 compare-and-swap + re-invite; §4 partial uniques |
| S4 invite-preview PII | §6/§7 no email in response, IP-throttled |
| S5 TTS | §7 authed, per-user throttle, out of Public |
| S6 `GET /today` | §7 circle-scoped `GET /today` |
| S7 storage orphans | §9 staging + nightly sweeper; §7 circle-delete Storage cleanup + integration test |
| S8 `handle_new_user` | §4 `full_name` coalesce/truncate; §11 test |
| S9 `POST /api/circles` | §6 one transaction, tz validation, org cap, ownership as-user |
| S10 `weekdayOf` | §8 stays pure; `effective_from` on `routine_items`; DST test days |
| S11 schema gaps | §4 indexes, `ON DELETE` per column, enum array, CHECKs, consent columns, consistency trigger |
| S12 missing endpoints + ops | §7 `POST`/`DELETE /shifts`, `DELETE /api/circles/:cid`; D18 email; §10 backup owner + restore test + audio bucket |
| S13 frontend design | §13 wiring-map constraint |
| S14 test plan | §11 expanded (bypass paths, write matrix, migration idempotency, `EXPLAIN`) |
| Nice-to-haves | `updated_at` (§4), `STABLE` helpers (§5), stable sort (§8), per-check-in `spoken_lang` (§4/§7/§8), `demoUtteranceId` verifies `is_demo` (§7/§8), threat-model boundary (§3/§15), **§16 Pilot acceptance criteria** |

Revised spec: `2026-09-08-amanah-multi-tenant-mvp-design.md` revision 2. Awaiting approval before `superpowers:writing-plans`.

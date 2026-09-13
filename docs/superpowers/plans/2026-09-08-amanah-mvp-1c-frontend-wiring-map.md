# 1c Frontend Wiring Map

Read directly from `frontend/src/{App.tsx,session.ts,api.ts,config.ts,FileSidebar.tsx}` and
cross-referenced against the real Part 1b route surface (`server/src/routes/*.ts`,
`server/src/http/app.ts`). This is Task 3 of the 1c plan — a document only, no frontend
code changes. **Frontend code (Tasks 4–11) does not start until Q1–Q8 below are answered.**

---

## 1. Auth model change

| `session.ts` export | Today | New (Supabase auth) |
|---|---|---|
| `getSession()` / `setSession()` | `{ token, user }` in `sessionStorage`, `user` shaped by `/api/auth/login` | keep the shape/API, but source `token` from `supabase.auth.getSession()` and `user` from `GET /api/me` (profile + circles) rather than a login response |
| `getToken()` | reads the stored token | reads the Supabase session's `access_token` |
| `homeFor(user)` | routes by `role` on a **single-persona** `User` | needs to route by **circle + role-in-that-circle** — `role` isn't a property of the signed-in user anymore, it's a property of a `circle_members` row (a user can belong to a circle with one role). See §3, Q6/Q7. |
| `ROLE_LABEL` | static map | unchanged — still valid vocabulary (`coordinator`/`caregiver`/`family`/`elder`) |

Today: `POST /api/auth/login` with a persona chip (or username+password) → token stored raw.
New: `supabase.auth.signInWithOtp({ email })` → user clicks the magic link → redirect completes
the session via `detectSessionInUrl` → `supabase.auth.getSession()` gives the JWT → `GET /api/me`
resolves which circle(s)/role(s) that JWT's `sub` belongs to.

**This is a bigger shape change than "swap the token source"**: today `User.role` is a fixed
property fetched once at login. In the new model, role is scoped per-circle
(`circle_members.role`), so every screen that reads `session.user.role` needs to instead read
"my role in the *current* circle" — which is why Task 7 (CircleProvider) exists as its own step
before Task 11 touches any screen.

---

## 2. Per-screen call map

| Screen / route | `api.*` call today | New call | Circle context needed? | Visual change? |
|---|---|---|---|---|
| **Elder** `/elder` | `api.today()`, `api.shifts()`, `api.checkins()`, `api.transcribe()`, `api.createCheckin()`, `api.setVisibility()`, `api.demoUtterances()` | `api.today(cid)`, `api.shifts(cid)`, `api.checkins(cid)` → `GET /circles/:cid/{today,shifts,checkins}`; `api.transcribe(cid,…)` → `POST /circles/:cid/checkins/transcribe`; `api.createCheckin(cid,…)` → `POST /circles/:cid/checkins`; `api.setVisibility` → `PATCH /circles/:cid/checkins/:id` (patch route, not a dedicated `/visibility` sub-path — see note below) | yes | none expected |
| **Coordinator** `/coordinator` | `api.careSignal()`, `api.shifts()`, `api.people()`, `api.tasks(date)`, `api.routine()`, `api.updateShift()`, `api.addRoutine()`, `api.updateRoutine()`, `api.deleteRoutine()`, `api.toggleTask()` | `…(cid)` for all of the above via `GET/PATCH /circles/:cid/{care-signal,shifts,plan,routine}`. **`api.people()` has no server-side replacement** — see Q8, this blocks the caregiver-assignment `<select>` and family/caregiver labeling until resolved. "Suggested move" callout block — **flagged Q2**, no data source in the MVP. | yes | callout block — **flagged Q2** |
| **Family** `/family` | `api.checkins()`, `api.tasks(date)` | `…(cid)` | yes | none expected |
| **Caregiver** `/caregiver` | `api.myShift()` (singular), `api.tasks(date)`, `api.toggleTask()` | `GET /my-shifts` (plural — a caregiver can now belong to more than one circle) instead of a single `myShift`; per-circle tasks stay `…(cid)`. The plural response shape needs a small adapter in the screen (today's UI renders one shift) — in scope for Task 11, not a flagged question. | yes | none expected |
| **File sidebar** (mounted in Coordinator, Caregiver, and Family — NOT Elder) | `api.files()`, `api.uploadFile()`, `api.downloadFile()`, `api.updateFile()`, `api.deleteFile()` | — no clinical-files endpoints exist anywhere in the new API (confirmed: no `/files` route in any 1b router). Cutting this is D16. | n/a | **flagged Q3: remove the mount (3 call sites) entirely, or hide behind a disabled state?** |
| **Sign-in screen** (`Login` in `App.tsx`) | persona chips (`signInAs`) + username/password form (`signIn`) | replaced by a new `SignIn.tsx` — email field, "send me a link" | n/a | **flagged Q1: new screen entirely** |
| **Demo access** (not a button — a hidden `Ctrl+Shift+R` keyboard shortcut, `ResetKey` component, `App.tsx:1342`) | `api.resetDemo()` → `POST /api/demo/reset` | — no `/demo/reset` endpoint exists in the new API | n/a | **flagged Q4: drop the shortcut, or repoint it to "create a fresh demo circle"?** |

**Note on `setVisibility`**: today's API has a dedicated `PATCH /checkins/:id/visibility`
sub-route; the 1b `checkins.ts` router only exposes a general `PATCH /checkins/:id`. Task 11
will need to send `{ visibility }` to the general patch route — not a flagged question, just an
implementation detail to get right when repointing that call.

---

## 3. New screens

- **`CreateCircle`** — shown when `GET /api/me` returns zero circles for the signed-in user.
  Posts to `POST /circles` (fields: `elder_name`, `elder_lang`, `timezone`, `attestation: true`,
  optional `org_id`).
- **`AcceptInvite`** (`/invite/:token`) — reads `GET /invites/:token` (public-ish, no circle
  membership required to view — the 1b Global Constraint's 5th `adminPool` exception), then
  `POST /invites/:token/accept` once signed in.
- **`PrivacyNotice`** — gates on `profiles.tos_accepted_at` / `privacy_notice_version` (from
  `GET /me`'s `profile` object); posts `POST /me/accept-notice` with a version string.

Routing when `api.me()` (→ `GET /api/me`) returns zero circles: **flagged Q6**.
Routing when a user has 2+ circles (e.g. a caregiver on two families' circles, or a coordinator
who set up a second circle): **flagged Q7**.

---

## 4. Flagged questions (answer before Tasks 5–11 start)

- **Q1** — Sign-in: replace the persona-chip + username/password screen with a single email
  field + "send me a link"? Or keep a dev-only persona shortcut behind an env flag (useful for
  fast local iteration, but it's more surface to keep secure/hidden in a deployed build)?
- **Q2** — The coordinator "Suggested move" callout (`App.tsx:1046-1065`, `data-testid=
  "button-apply-suggested-move"`): it has no data source in the MVP (D16). Remove the block
  entirely, or leave a placeholder ("pattern insights coming later")?
- **Q3** — The clinical-files sidebar (`FileSidebar.tsx`, mounted in Coordinator/Caregiver/
  Family): remove the mount and the 5 `api.*Files*` calls entirely, or hide behind a
  disabled/"coming later" state?
- **Q4** — The hidden demo-reset shortcut (`Ctrl+Shift+R`, no visible button): remove it, since
  `/api/demo/reset` no longer exists server-side, or repoint it to "create a fresh demo circle"
  (`POST /circles` with a demo flag)?
- **Q5** — The "Steady"/mood labels (`MOOD_TAG.ok.word = "Steady"`, `M.ok = "Steady"`): leave
  exactly as-is, or is an `ok` label rename ("Steady" → "OK") in scope here? (Copy change →
  needs approval regardless of answer.)
- **Q6** — When `GET /api/me` returns zero circles: route straight to `CreateCircle`, or show a
  one-line "you're not in a circle yet" landing first (useful if the user arrived expecting an
  invite email that hasn't landed yet)?
- **Q7** — Multi-circle users (rare in pilot, but real: e.g. a caregiver serving two families):
  the spec cuts the switcher UI. Confirm: just use `circles[0]` silently, no indicator?
- **Q8 (found during this wiring pass, not in the plan's original Q-list)** — **The coordinator
  screen's `api.people()` call has no server-side replacement.** It's used for two things today:
  labeling `caregiverIsFamily` on each shift, and populating the "assign caregiver" `<select>`
  in the Upcoming-visit panel. `GET /api/me` only returns the *caller's own* circles, not a
  circle's member roster — there is no `GET /circles/:cid/members` (or equivalent) endpoint
  anywhere in the 1b route surface (`circles.ts` has `POST /circles`, `DELETE /circles/:cid`,
  `DELETE /circles/:cid/members/:userId` — no read). **This blocks Task 11's coordinator
  screen** unless one of: (a) a new `GET /circles/:cid/members` endpoint is added as part of
  1c (small, RLS already scopes `circle_members` reads correctly — this would mostly be new
  route wiring, not new authorization logic), (b) the assign-caregiver dropdown and family
  labeling are cut from this pass (a real MVP capability regression, not just cosmetic), or
  (c) some other minimal-membership-list shape is added instead. Recommend (a) — it's a small,
  well-scoped addition, not a new plan.

---

## 5. Answer key (for reference once filled in)

_Not filled in yet — waiting on the user's answers to Q1–Q8 above._

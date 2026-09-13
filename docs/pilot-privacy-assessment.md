# Pre-pilot privacy assessment

**Status: not signed off. No real elder's data may enter this system until the sign-off
line at the bottom of this document is dated and initialed by the project owner.**

This document exists because Amanah's first real users will be an actual elderly
person and her actual family, not fictional demo data — and because Part 1c is the
point where the app can, for the first time, technically hold that data (Supabase
Storage for audio, real magic-link accounts, real circles). It is not a legal opinion;
it is an honest inventory of what the system does, in plain language, written by the
people who built it, for the person who will decide whether it's ready.

## 1. Data inventory

| Data element | Where stored | Retention | Who can see it |
|---|---|---|---|
| Mood (good/steady/hard) | `checkins.mood` | Until the circle is deleted | Any active member of the circle (not visibility-gated — see §3 of the pilot's own privacy notice, `frontend/src/onboarding/PrivacyNotice.tsx`) |
| Check-in transcript + translation | `checkin_content.transcript`/`.translation` | Until the circle is deleted | Gated per-checkin by a visibility tier the recorder chose: `circle` (everyone), `family` (coordinator + family members), `coordinator` (coordinator only), `mood_only` (no one — content never shown, only mood) |
| Check-in audio recording | Supabase Storage, private `audio` bucket | Until the circle is deleted (or 24h if never promoted past staging — see `sweepOrphans`) | Same visibility tier as the transcript; served only as a 120-second signed URL through the API, never a public link |
| Who came, what they did, when (shifts) | `shifts` | Until the circle is deleted | Any active member of the circle |
| Weekly care plan / daily tasks | `routine_items`, `completions`, `adhoc_tasks` | Until the circle is deleted | Any active member of the circle |
| Name, email, language, notice-acceptance | `profiles` | Until the account's last circle membership ends (org owner rows persist until the org's circles are gone) | The person themself; a coordinator sees a circle-mate's name via `GET /circles/:cid/members` |
| Circle membership + role | `circle_members` | Until removed from the circle or the circle is deleted | Any active member of the circle |

Nothing else about the elder is collected. There is no location tracking, no device
fingerprinting, no analytics pipeline, no third-party ad/tracking script anywhere in
this codebase.

## 2. Cross-border transfer assessment (OpenAI, United States)

**What leaves Canada:** the recorded audio bytes and the resulting transcript text,
sent to `api.openai.com` (Whisper for transcription/translation, `tts-1` for the
elder's own read-aloud feature) and back. Nothing else — no shift data, no plan data,
no member list — ever leaves this system's own infrastructure (Supabase `ca-central-1`,
Fly.io `yul`).

**Legal basis relied on for the pilot:** explicit, informed consent, captured at
sign-up via the privacy notice every user must accept before creating or joining a
circle (`profiles.tos_accepted_at` + `privacy_notice_version`, enforced server-side by
`requireNoticeAccepted` on every write route that touches check-in content).

**Safeguard:** per OpenAI's API terms, data submitted through the API is not used to
train their models, and is retained for up to 30 days for abuse-monitoring purposes,
then deleted. This is OpenAI's own published policy, not something this project
controls or can verify happened for any specific request — it is a contractual
assurance, not a technical guarantee this codebase enforces.

**Residual risk, stated plainly:** the recording and transcript are, for up to 30
days, present on a US company's infrastructure, subject to US law (including the
possibility of US government legal process reaching that data while it's there,
independent of anything Canadian law would otherwise require). Choosing Supabase's
`ca-central-1` region and Fly's `yul` region for the rest of the system is a
data-minimization choice — it keeps everything else in Canada — **it is not a
compliance certification and does not change this specific residual risk for the
portion of data that necessarily transits OpenAI's US endpoints.** Anyone relying on
this pilot for a use case with a hard data-residency requirement (e.g. certain
healthcare or public-sector contexts) should treat this paragraph as a blocker to
resolve first, not a formality to sign past.

## 3. Consent & authority

**Privacy notice**, version `2026-09-1c-v1` (`PRIVACY_NOTICE_VERSION`, defined in
`frontend/src/circle.tsx`, re-exported from `frontend/src/onboarding/PrivacyNotice.tsx`
— the single source both the frontend gate and this document check against). Full
current text is the `NOTICE` constant in `PrivacyNotice.tsx`; it covers what's
collected, who can see it, the OpenAI transfer (§2 above, in plain language), retention,
and deletion rights. No one reaches `/create-circle` or any circle-scoped screen
without accepting this exact version (`RequireCircle` in `circle.tsx` redirects to
`/privacy-notice` first, before the circle-count check — a signed-in, not-yet-accepted
user can never reach circle creation).

**Coordinator authority attestation**, required at circle creation
(`frontend/src/onboarding/CreateCircle.tsx`, enforced server-side —
`POST /circles` 400s without `attestation: true`):

> "I have the authority to arrange care for her — I'm her family, or she's asked me
> to coordinate this."

This is a self-attestation, not a verified credential. The system has no way to
confirm a coordinator's actual relationship to the elder beyond this checkbox. For a
pilot run through people the project owner already knows and trusts, this is an
accepted, disclosed limitation — it would need a real verification step before any
onboarding flow open to strangers.

## 4. Access & deletion

Two real paths exist today:

- **Whole-circle deletion**: `DELETE /api/circles/:cid`, restricted to the
  organization owner (`circles.ts`). Cascades every row scoped to that circle
  (checkins, checkin_content, shifts, routine_items, completions, adhoc_tasks,
  circle_members, invites — all `ON DELETE CASCADE` from `circles`), then calls
  `deleteCircleAudio(cid)` to remove every Storage object under that circle's prefix.
  This is irreversible — there is no soft-delete or recovery window.
- **Single check-in deletion**: `DELETE /api/circles/:cid/checkins/:id`. RLS's
  `del_checkins` policy permits this for the elder herself, a coordinator, or (for a
  proxy check-in someone else recorded on her behalf) the person who recorded it.
  This does not remove that checkin's audio from Storage automatically today — the
  audio object becomes unreferenced and is caught by the nightly `sweepOrphans` job
  (see §5) within 24 hours, not instantly.

There is no single "delete everything about just me, but leave the rest of the circle
intact" operation — removing a member (`DELETE /circles/:cid/members/:userId`) ends
their access and future participation, but does not retroactively delete check-ins
they already recorded or that reference them. A request along those lines today means
a coordinator manually deleting the specific check-ins in question. **Target turnaround
for any deletion request: 7 days.** This is a target, not an automated SLA — there is
no ticketing/tracking system behind it yet; a request has to reach the project owner
directly (e.g. by asking whoever invited them).

## 5. Retention & backups

- Nightly `pg_dump` of the whole database + a mirror of the `audio` Storage bucket
  (`server/scripts/backup.sh`), run by `.github/workflows/nightly.yml`'s `backup` job,
  uploaded as a GitHub Actions artifact with 30-day retention.
- A same-workflow `sweep` job runs `sweepOrphans(24)` nightly — deletes any Storage
  object older than 24 hours that no `checkin_content.audio_path` references (covers
  abandoned staging uploads and orphans left by the single-checkin-deletion gap in §4).
- **Both jobs are currently dormant** (gated behind a `DEPLOYED` repo variable — see
  `docs/deploy.md` step 10) until Part 1c's deploy actually happens. They do not run
  today, against nothing deployed; this is stated here so "nightly backups exist" isn't
  read as true before it actually is.
- `server/scripts/restore-test.sh` proves a backup is actually restorable — spins a
  fresh local Supabase, loads the dump, runs the integration test suite against it.
  This is a manual script, not on an automated schedule. **Recommended cadence:
  quarterly once deployed, and once immediately before onboarding the first real
  family** — stated as a recommendation because no automation enforces it yet.

## 6. Residual risks accepted for the pilot

- **A compromise of the Fly host is a compromise of RLS itself.** Both the
  RLS-restricted `appPool` and the `BYPASSRLS`-capable `adminPool` credentials live on
  the same process. RLS is the correctness boundary between tenants and between
  visibility tiers — it is not a security boundary against the API server's own host
  being compromised. Anyone with code execution on that host has effectively
  unrestricted access to every circle's data, elder audio included. **Partially
  reduced, not eliminated:** `docs/deploy.md` step 12 restricts the database to only
  accept connections from the Fly app's own IP (Supabase Network Restrictions) — this
  shrinks who/what can even attempt a raw connection, but does nothing once the host
  itself is the thing making that connection. Not yet applied — it's a deploy-time
  step, and nothing is deployed yet.
- **Audit log — now real, not absent.** A dedicated `audit_log` table (migration
  `20260913000001`, `server/src/audit.ts`) records who accessed check-in audio, who
  listed a circle's check-ins, and every destructive/membership action (check-in
  deletion, circle deletion, member removal) — actor, circle, target, timestamp.
  RLS-locked the same way the audio bucket is: `app_authenticated` cannot read or
  write it under any circumstance, only the server's admin connection can, and that's
  verified by test, not assumed. This does not cover every read path (e.g. an
  individual check-in's mood isn't separately logged), and it lives in the same
  database RLS itself lives in — a host compromise that bypasses RLS could also alter
  or erase audit rows. A meaningfully stronger version would ship logs to storage the
  compromised host can't reach; out of scope for this pilot.
- **Single API instance, single Postgres project.** No redundancy. An outage means the
  elder cannot check in that night and no one can see the schedule until it's back —
  an availability risk, not a confidentiality one, but worth naming: this pilot has no
  failover.
- **The cross-border OpenAI transfer** (§2) is a residual risk independent of
  everything above, already covered there in detail — repeated here only as a pointer,
  not to understate it by omission from this list.

None of these are hidden from the people being asked to trust this system with real
data — that is the point of writing them down here, not after something goes wrong.

## 7. Sign-off

By signing below, the project owner confirms they have read this document in full,
understand the risks in §6 and the residual cross-border risk in §2, and authorize
onboarding a real elder and her family into this system.

**Signed:** _______________________  **Date:** _______________

**Until this line is dated and initialed, no real elder data enters this system.**

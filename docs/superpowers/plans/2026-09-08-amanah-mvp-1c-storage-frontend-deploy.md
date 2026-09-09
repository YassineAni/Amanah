# Amanah MVP — Part 1c: Storage, Frontend Wiring & Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put audio in Supabase Storage with signed-URL playback and an orphan sweeper; connect the existing Vite frontend to the new API on magic-link auth **without changing its visuals**; deploy the whole thing (Supabase `ca-central-1` + Fly.io `yul` + a static host) with CI deploying on `main`; and deliver the pre-pilot privacy assessment that gates onboarding a real family.

**Architecture:** One private Supabase Storage bucket `audio`, objects at `<circle_id>/<uuid>.<ext>`, staged under `<circle_id>/staging/`. The API (`service_role`) is the only reader/writer; download is an RLS check on `checkin_content` → a 120 s signed URL. The frontend keeps its current React 19 + Vite structure and visual language; a delivered-first **wiring map** enumerates every screen's API call change and every place a change would be visible (each of those is a user decision, not a code step). Deploy: `supabase db push`, a Fly container for the API, a static build for the SPA.

**Tech Stack:** Supabase Storage + CLI, `@supabase/supabase-js` (server storage client + browser auth client), Fly.io (`flyctl`), a static host (Vercel or Cloudflare Pages), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-08-amanah-multi-tenant-mvp-design.md` (revision 2). Implements §9 (storage), §10 (deployment), §12 (data-protection / the D19 gate), §13 (frontend wiring constraint), and the remaining §11 items (backup + restore test). **Depends on Parts 1a and 1b merged and green.**

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec.

- **The frontend's visuals do not change.** A **wiring map is delivered first** (Task 3); no frontend code is written until the user has answered its flagged questions. No layout, colour, copy, or component change beyond what the map explicitly approves (§13, memory: `preserve-frontend-when-wiring`).
- **One private bucket, `audio`.** Objects `<circle_id>/<uuid>.<ext>`; staging under `<circle_id>/staging/<uuid>.<ext>`. `authenticated` / `anon` are denied direct bucket access. The API is the only reader; downloads are 120 s signed URLs issued after an RLS check on `checkin_content` (§9).
- **Orphan sweeper** (nightly, `service_role`): deletes any `audio/<cid>/**` object — staging or promoted — older than 24 h with no matching `checkin_content.audio_path` (§9).
- **Backups**: a nightly job owned by a **GitHub Actions scheduled workflow** runs `pg_dump` **and** mirrors the `audio` bucket; a **restore test** rebuilds a throwaway project and runs the integration suite (§10, §11).
- **Region**: Supabase project `ca-central-1`; Fly.io primary region `yul`, 1 instance. This is a data-minimisation choice, not a Law 25 compliance claim (§10, D10).
- **`DATABASE_URL` stays a direct (5432) / session-pinned connection — not the transaction pooler** (§10, D20).
- **The pre-pilot privacy assessment (D19) is a hard gate** — no real elder data (pilot included) until `docs/pilot-privacy-assessment.md` is complete and signed off (§12).
- Auth is **magic link only**; UI is **EN only** (D9, D17). No clinical-files UI, no circle-switcher UI (D16).

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260908000016_storage_audio_bucket.sql` | Create the private `audio` bucket; deny direct access |
| `server/src/storage/audio.ts` | **Real** `uploadStaging` / `promoteStaging` / `signedUrl` / `deleteCircleAudio` / `sweepOrphans` (replaces the 1b stubs) |
| `server/scripts/sweep-orphans.ts` | CLI entry for the nightly sweeper |
| `server/scripts/backup.sh` | `pg_dump` + `audio` bucket mirror |
| `server/scripts/restore-test.sh` | Rebuild a throwaway project from a backup and run the integration suite |
| `.github/workflows/nightly.yml` | Scheduled: sweep + backup |
| `.github/workflows/deploy.yml` | On `main`: `supabase db push` → `flyctl deploy` → static deploy |
| `server/Dockerfile`, `server/.dockerignore`, `server/fly.toml` | API container + Fly config |
| `docs/superpowers/plans/2026-09-08-amanah-mvp-1c-frontend-wiring-map.md` | **Delivered first.** Screen-by-screen call map + flagged questions |
| `frontend/src/supabaseClient.ts` | Browser Supabase client (auth only) |
| `frontend/src/SignIn.tsx` | Magic-link sign-in screen |
| `frontend/src/session.ts` | Rewritten: wraps `supabase.auth` |
| `frontend/src/circle.tsx` | Active-circle context provider + `<RequireCircle>` |
| `frontend/src/api.ts` | Rewritten: bearer from `getToken()`, `:cid` path segment, new onboarding calls, dropped calls |
| `frontend/src/onboarding/CreateCircle.tsx`, `AcceptInvite.tsx`, `PrivacyNotice.tsx` | Onboarding screens |
| `frontend/src/App.tsx` | Edited: thread `activeCircle.id` into calls; apply wiring-map decisions |
| `frontend/.env.example` | `VITE_API_BASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `docs/pilot-privacy-assessment.md` | The D19 gate deliverable |
| `docs/deploy.md` | One-time deploy runbook (Supabase project, secrets, hosts) |

---

## Task 1: Storage — create the private `audio` bucket

**Files:**
- Create: `supabase/migrations/20260908000016_storage_audio_bucket.sql`

**Interfaces:**
- Produces: a private bucket named `audio`; no `storage.objects` policy for `anon` / `authenticated` (so only `service_role` can read/write).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260908000016_storage_audio_bucket.sql`:
```sql
-- Private bucket. No policies for anon/authenticated on storage.objects, so
-- only service_role (the API) can read or write. Downloads happen through
-- the API as 120s signed URLs after an RLS check on checkin_content. (§9)
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

-- Belt-and-braces: make sure no permissive policy exists on this bucket.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and qual ilike '%audio%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select id, public from storage.buckets where id='audio';"
```
Expected: one row, `public = f`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260908000016_storage_audio_bucket.sql
git commit -m "feat(1c): migration 016 — private audio bucket"
```

---

## Task 2: Storage module — real implementation

**Files:**
- Rewrite: `server/src/storage/audio.ts` (replaces the Part 1b stubs)
- Create: `server/test/api/storage-audio.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` (from `server/src/supabaseAdmin.js`), `adminPool` (for `sweepOrphans`).
- Produces (same signatures the 1b stubs and callers already use):
  - `uploadStaging(cid: string, buf: Buffer, ext: string): Promise<string>` → `"<cid>/staging/<uuid>.<ext>"` (the object key within the bucket).
  - `promoteStaging(stagingPath: string): Promise<string>` → copies to `"<cid>/<uuid>.<ext>"`, removes the staging object, returns the new key.
  - `signedUrl(path: string, ttlSec: number): Promise<string>`.
  - `deleteCircleAudio(cid: string): Promise<void>` — lists and removes every object under `<cid>/` (including `staging/`).
  - `sweepOrphans(olderThanHours = 24): Promise<{ deleted: number }>` — lists all objects, deletes those older than the cutoff with no matching `checkin_content.audio_path`.

- [ ] **Step 1: Rewrite `server/src/storage/audio.ts`**

```ts
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { adminPool } from "../db/pool.js";

const BUCKET = "audio";
const store = () => supabaseAdmin.storage.from(BUCKET);

export async function uploadStaging(cid: string, buf: Buffer, ext: string): Promise<string> {
  const key = `${cid}/staging/${randomUUID()}.${ext.replace(/^\./, "")}`;
  const { error } = await store().upload(key, buf, { contentType: `audio/${ext}`, upsert: false });
  if (error) throw new Error(`audio upload failed: ${error.message}`);
  return key;
}

export async function promoteStaging(stagingPath: string): Promise<string> {
  const m = stagingPath.match(/^([0-9a-f-]{36})\/staging\/(.+)$/i);
  if (!m) throw new Error("not a staging path");
  const dest = `${m[1]}/${m[2]}`;
  const { error: copyErr } = await store().copy(stagingPath, dest);
  if (copyErr) throw new Error(`promote failed: ${copyErr.message}`);
  await store().remove([stagingPath]);
  return dest;
}

export async function signedUrl(path: string, ttlSec: number): Promise<string> {
  const { data, error } = await store().createSignedUrl(path, ttlSec);
  if (error || !data) throw new Error(`sign failed: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export async function deleteCircleAudio(cid: string): Promise<void> {
  for (const prefix of [`${cid}`, `${cid}/staging`]) {
    const { data } = await store().list(prefix, { limit: 1000 });
    const keys = (data ?? []).map((o) => `${prefix}/${o.name}`);
    if (keys.length) await store().remove(keys);
  }
}

export async function sweepOrphans(olderThanHours = 24): Promise<{ deleted: number }> {
  const cutoff = Date.now() - olderThanHours * 3_600_000;
  const referenced = new Set<string>(
    (await adminPool.query(`select audio_path from public.checkin_content where audio_path is not null`))
      .rows.map((r) => r.audio_path as string),
  );
  let deleted = 0;
  // one level of circle folders
  const { data: circles } = await store().list("", { limit: 10_000 });
  for (const dir of circles ?? []) {
    if (dir.id) continue; // files at root are unexpected; skip
    for (const prefix of [dir.name, `${dir.name}/staging`]) {
      const { data: objs } = await store().list(prefix, { limit: 10_000 });
      const stale = (objs ?? [])
        .filter((o) => o.id) // real objects only
        .filter((o) => new Date(o.created_at ?? o.updated_at ?? 0).getTime() < cutoff)
        .map((o) => `${prefix}/${o.name}`)
        .filter((key) => !referenced.has(key));
      if (stale.length) {
        await store().remove(stale);
        deleted += stale.length;
      }
    }
  }
  return { deleted };
}
```

- [ ] **Step 2: Write + run the test** (against local Supabase Storage)

Create `server/test/api/storage-audio.test.ts`:
```ts
import { afterAll, expect, test } from "vitest";
import { uploadStaging, promoteStaging, signedUrl, deleteCircleAudio, sweepOrphans } from "../../src/storage/audio.js";
import { randomUUID } from "node:crypto";

const cid = randomUUID();
afterAll(() => deleteCircleAudio(cid));

test("upload -> promote -> sign round trip", async () => {
  const staging = await uploadStaging(cid, Buffer.from("fake-audio"), "webm");
  expect(staging).toMatch(new RegExp(`^${cid}/staging/`));
  const promoted = await promoteStaging(staging);
  expect(promoted).toMatch(new RegExp(`^${cid}/[0-9a-f-]+\\.webm$`));
  const url = await signedUrl(promoted, 120);
  expect(url).toContain("token=");
});

test("sweepOrphans deletes an unreferenced staging object", async () => {
  await uploadStaging(cid, Buffer.from("orphan"), "webm");
  // olderThanHours = 0 -> everything unreferenced is stale
  const { deleted } = await sweepOrphans(0);
  expect(deleted).toBeGreaterThanOrEqual(1);
});
```
Run:
```bash
npx supabase start && npx supabase db reset
npm --prefix server run test:db -- storage-audio
```
Expected: PASS.

- [ ] **Step 3: Confirm the 1b callers still pass**

The 1b `deleteCircleAudio` stub logged a warning; it is now replaced. No caller change needed (signatures identical). Run the 1b storage-dependent suites:
```bash
npm --prefix server run test:db -- checkins-write circles-delete integration/loop
```
(These mock the storage module, so they still pass; the point is to confirm the import surface is unchanged.)

- [ ] **Step 4: Retire the single-tenant server modules**

The RLS suite (Part 1a) and the differential test (Part 1b Task 22) are green, so `consent.ts` has served its purpose as the oracle. Delete the modules that Part 1b excluded from the build:
```bash
git rm server/src/auth.ts server/src/consent.ts server/src/db.ts server/src/scan.ts \
       server/src/seed.ts server/src/plan.ts server/src/careSignal.ts server/src/transcribe.ts \
       server/src/types.ts server/audio/u1.wav server/audio/u2.wav server/audio/u3.wav
```
Then remove the `"exclude"` list added to `server/tsconfig.json` in Part 1b Task 23 (it referenced these files) and delete `server/test/db/consent-diff.test.ts`. Run the full suite + typecheck:
```bash
npm --prefix server run typecheck
npm --prefix server run test:db
```
Both must be green with the files gone.

- [ ] **Step 5: Commit**

```bash
git add -A server
git commit -m "feat(1c): real Supabase Storage audio module; retire single-tenant modules"
```

---

## Task 3: Deliver the frontend wiring map — GATE

**Files:**
- Create: `docs/superpowers/plans/2026-09-08-amanah-mvp-1c-frontend-wiring-map.md`

**Interfaces:**
- Produces: a document. **No frontend code in this task.** After delivery, wait for the user to answer the flagged questions. Tasks 5–11 reference the answers as "wiring-map item N".

- [ ] **Step 1: Read the current frontend surface**

```bash
sed -n '1,80p' frontend/src/App.tsx
grep -n "api\.\|useRoute\|<Route\|path=\|session\|getSession" frontend/src/App.tsx
sed -n '1,60p' frontend/src/FileSidebar.tsx
cat frontend/src/config.ts frontend/src/session.ts
```
Note every `api.*` call, every route, and every place `session` / persona is read.

- [ ] **Step 2: Write the wiring map**

Create `docs/superpowers/plans/2026-09-08-amanah-mvp-1c-frontend-wiring-map.md` with these sections:

1. **Auth model change** — today: `POST /api/auth/login` with a persona chip → token in `sessionStorage`. New: `supabase.auth.signInWithOtp({ email })` → magic link → `supabase.auth.getSession()` token. Table: each of `session.ts`'s exports (`getSession`, `setSession`, `getToken`, `homeFor`, `ROLE_LABEL`) → keep / change / drop.
2. **Per-screen call map** — one row per screen/route in `App.tsx`:

   | Screen / route | `api.*` call today | New call | Circle context needed? | Visual change? |
   |---|---|---|---|---|
   | (fill from Step 1 — e.g. Elder home `/elder`) | `api.today()`, `api.checkins()`, `api.transcribe()`, `api.createCheckin()` | `api.today(cid)`, `api.checkins(cid)`, `api.transcribe(cid, …)`, `api.createCheckin(cid, …)` | yes | none expected |
   | Coordinator `/coordinator` | `api.careSignal()`, `api.shifts()`, `api.updateShift()`, `api.routine()` … | `…(cid)` | yes | callout block disappears — **flagged Q** |
   | Family `/family` | `api.checkins()`, `api.tasks()` | `…(cid)` | yes | none expected |
   | Caregiver `/caregiver` | `api.myShift()`, `api.tasks()`, `api.toggleTask()` | `api.myShifts()` (plural), `…(cid)` | yes | none expected |
   | File sidebar (mounted in `App.tsx`) | `api.files()`, `api.uploadFile()`, `api.downloadFile()` | — (clinical files cut, D16) | n/a | **flagged Q: remove the mount** |
   | Sign-in screen | `api.login()` + persona chips | `SignIn.tsx` (email field) | n/a | **flagged Q: new screen** |
   | Demo reset button (if present) | `api.resetDemo()` | — (`POST /api/demo/reset` deleted) | n/a | **flagged Q: remove the button** |

3. **New screens** — `CreateCircle`, `AcceptInvite` (`/invite/:token`), `PrivacyNotice`. Where each mounts, and what the routing looks like when `api.me()` returns zero circles.
4. **Flagged questions (require the user's answer before Tasks 5–11):**
   - **Q1** — Sign-in: replace the persona-chip screen with a single email field + "send me a link"? Or keep a dev-only persona shortcut behind an env flag?
   - **Q2** — The coordinator "suggested move" / correlation callout block: it has no data source in the MVP (D16). Remove the block, or leave an empty placeholder that says "pattern insights coming later"?
   - **Q3** — The clinical-files sidebar: remove the mount and the toggle entirely, or hide it behind a disabled state?
   - **Q4** — Demo-reset button (if it exists in `App.tsx`): remove, or repoint to "create a fresh demo circle"?
   - **Q5** — The "Steady"/mood labels: leave exactly as-is, or is the `ok` label rename ("Steady" → "OK") in scope here? (It is a copy change → needs approval.)
   - **Q6** — When `api.me()` returns no circles: route straight to `CreateCircle`, or show a one-line "you're not in a circle yet" landing first?
   - **Q7** — Multi-circle users (rare in pilot): the spec cuts the switcher UI. Confirm: just use `circles[0]` silently, no indicator?

- [ ] **Step 3: Deliver and stop**

Send the file to the user (`SendUserFile`). State plainly: *frontend code (Tasks 5–11) does not start until Q1–Q7 are answered.* Do not proceed.

- [ ] **Step 4: Commit the map**

```bash
git add docs/superpowers/plans/2026-09-08-amanah-mvp-1c-frontend-wiring-map.md
git commit -m "docs(1c): frontend wiring map + flagged questions (GATE before frontend code)"
```

---

## Task 4: Frontend — Supabase client + env (no visual change)

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/supabaseClient.ts`
- Modify: `frontend/src/config.ts`
- Create: `frontend/.env.example`
- Modify: `frontend/.env`

**Interfaces:**
- Produces: `supabase` (browser client, auth only — `persistSession: true`, `detectSessionInUrl: true` for the magic-link redirect); `API_BASE` unchanged; new `SUPABASE_URL` / `SUPABASE_ANON_KEY` config exports.

- [ ] **Step 1: Install**

```bash
npm --prefix frontend install @supabase/supabase-js@^2.45
```

- [ ] **Step 2: Rewrite `frontend/src/config.ts`**

```ts
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
```

- [ ] **Step 3: Create `frontend/src/supabaseClient.ts`**

```ts
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // completes the magic-link redirect
  },
});
```

- [ ] **Step 4: Env files**

`frontend/.env.example`:
```
VITE_API_BASE=http://localhost:8787
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=
```
Append the same three keys to `frontend/.env` (fill `VITE_SUPABASE_ANON_KEY` from `npx supabase status`).

- [ ] **Step 5: Typecheck + commit**

```bash
npm --prefix frontend run typecheck
git add frontend/package.json frontend/package-lock.json frontend/src/supabaseClient.ts frontend/src/config.ts frontend/.env.example frontend/.env
git commit -m "chore(1c): browser Supabase client + env (no UI change)"
```

---

## Task 5: Frontend — `session.ts` on Supabase auth

**Files:**
- Rewrite: `frontend/src/session.ts`
- Create: `frontend/src/session.test.ts` (light — logic only)

**Interfaces:**
- Consumes: `supabase`.
- Produces (keep names stable per wiring-map §1):
  - `getToken(): Promise<string | null>` — `supabase.auth.getSession()` access token. (Now async — callers in `api.ts` already `await`.)
  - `onAuthChange(cb: (signedIn: boolean) => void): () => void` — subscribes to `supabase.auth.onAuthStateChange`.
  - `signOut(): Promise<void>`.
  - `homeFor(role: string): string` — unchanged mapping, minus the `cg-lea` persona special-case (per wiring-map Q1).
  - `ROLE_LABEL` — unchanged.
- Removed: `getSession` / `setSession` (the persona `sessionStorage` blob) — per wiring-map Q1.

- [ ] **Step 1: Rewrite `frontend/src/session.ts`**

```ts
import { supabase } from "./supabaseClient";

export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(!!session));
  return () => data.subscription.unsubscribe();
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export function homeFor(role: string): string {
  switch (role) {
    case "elder": return "/elder";
    case "coordinator": return "/coordinator";
    case "caregiver": return "/caregiver";
    case "family": return "/family";
    default: return "/";
  }
}

export const ROLE_LABEL: Record<string, string> = {
  elder: "Elder", coordinator: "Coordinator", caregiver: "Caregiver", family: "Family",
};
```

- [ ] **Step 2: Light test**

Create `frontend/src/session.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { homeFor, ROLE_LABEL } from "./session";

describe("homeFor", () => {
  test("maps every role", () => {
    expect(homeFor("elder")).toBe("/elder");
    expect(homeFor("coordinator")).toBe("/coordinator");
    expect(homeFor("caregiver")).toBe("/caregiver");
    expect(homeFor("family")).toBe("/family");
  });
  test("unknown role -> /", () => expect(homeFor("nope")).toBe("/"));
});
test("ROLE_LABEL has all four", () => {
  expect(Object.keys(ROLE_LABEL).sort()).toEqual(["caregiver","coordinator","elder","family"]);
});
```
Add a `frontend` test script if absent: `"test": "vitest run"`. Install `vitest` in `frontend` devDeps. Run `npm --prefix frontend test`.

- [ ] **Step 3: Typecheck + commit**

```bash
npm --prefix frontend run typecheck
git add frontend/src/session.ts frontend/src/session.test.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(1c): session.ts wraps supabase.auth (magic-link)"
```

---

## Task 6: Frontend — `api.ts` rewrite (bearer + `:cid` + onboarding calls)

**Files:**
- Rewrite: `frontend/src/api.ts`

**Interfaces:**
- Produces the typed client for the Part-1b API. Every circle-scoped method takes `cid` as its first argument. New: `me()`, `acceptNotice(version)`, `createCircle(body)`, `invitePreview(token)`, `acceptInvite(token)`, `deleteCircle(cid)`, `myShifts()`. Removed: `login`, `session`, `people`, `prayerTimes`, `resetDemo`, `files*` (per wiring-map).

- [ ] **Step 1: Rewrite `frontend/src/api.ts`**

```ts
import { API_BASE } from "./config";
import { getToken } from "./session";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message); this.status = status; this.code = code;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText, code: string | undefined;
    try { const b = await res.json(); msg = b?.error ?? msg; code = b?.code; } catch { /* keep */ }
    throw new ApiError(res.status, msg, code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}
const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export type Role = "elder" | "coordinator" | "caregiver" | "family";
export type Mood = "good" | "ok" | "hard";
export type Visibility = "circle" | "family" | "coordinator" | "mood_only";

export type Me = {
  profile: { id: string; email: string; full_name: string; ui_lang: string;
             tos_accepted_at: string | null; privacy_notice_version: string | null };
  circles: { id: string; name: string; role: Role; is_demo: boolean }[];
};
export type Checkin = {
  id: string; occurred_on: string; mood: Mood; spoken_lang: string; is_proxy: boolean;
  visibility: Visibility; recorded_by_name: string;
  transcript: string | null; translation: string | null; has_audio: boolean;
};
export type StripDay = {
  date: string; offset: number; isPast: boolean; mood: Mood | null;
  noteHidden: boolean; checkinOn: boolean;
  shifts: { caregiverName: string | null; tags: string[] }[];
};
export type PlanRow = {
  key: string; kind: "routine" | "adhoc"; title: string; scheduledTime: string;
  category: string; timeSensitive: boolean;
  doneAt: string | null; doneById: string | null; doneByName: string | null;
  note: string | null; weekdays?: number[]; addedByName?: string;
};
export type RoutineItem = {
  id: string; title: string; time_of_day: string; category: string;
  time_sensitive: boolean; weekdays: number[]; effective_from: string;
};

export const api = {
  // account / tenancy
  me: () => req<Me>("/api/me"),
  acceptNotice: (version: string) =>
    req<void>("/api/me/accept-notice", { method: "POST", ...json({ version }) }),
  createCircle: (b: { elder_name: string; elder_lang: string; timezone: string; attestation: true; org_id?: string }) =>
    req<{ circle: { id: string; name: string } }>("/api/circles", { method: "POST", ...json(b) }),
  invitePreview: (token: string) =>
    req<{ circle_name: string; inviter_name: string; role: Role }>(`/api/invites/${token}`),
  acceptInvite: (token: string) =>
    req<{ circle_id: string }>(`/api/invites/${token}/accept`, { method: "POST", ...json({}) }),
  deleteCircle: (cid: string) => req<void>(`/api/circles/${cid}`, { method: "DELETE" }),
  myShifts: () => req<{ shifts: { id: string; circle_id: string; circle_name: string; starts_at: string; ends_at: string; purpose: string }[] }>("/api/my-shifts"),

  // check-ins
  today: (cid: string) =>
    req<{ today: string; has_checkin: boolean; last_mood: Mood | null }>(`/api/circles/${cid}/today`),
  checkins: (cid: string) => req<Checkin[]>(`/api/circles/${cid}/checkins`),
  demoUtterances: (cid: string) => req<{ id: string; label: string }[]>(`/api/circles/${cid}/demo/utterances`),
  transcribe: (cid: string, input: Blob | { demoUtteranceId: string }, spokenLang?: string) => {
    const fd = new FormData();
    if (input instanceof Blob) fd.append("audio", input, "checkin.webm");
    else fd.append("demoUtteranceId", input.demoUtteranceId);
    if (spokenLang) fd.append("spoken_lang", spokenLang);
    return req<{ transcript: string; translation: string; spoken_lang: string; staging_path: string | null }>(
      `/api/circles/${cid}/checkins/transcribe`, { method: "POST", body: fd });
  },
  createCheckin: (cid: string, b: {
    occurred_on?: string; mood: Mood; transcript: string; translation?: string;
    spoken_lang?: string; visibility?: Visibility; staging_path?: string | null;
  }) => req<{ id: string }>(`/api/circles/${cid}/checkins`, { method: "POST", ...json(b) }),
  setVisibility: (cid: string, id: string, visibility: Visibility) =>
    req<{ id: string; visibility: Visibility }>(`/api/circles/${cid}/checkins/${id}`, { method: "PATCH", ...json({ visibility }) }),
  deleteCheckin: (cid: string, id: string) =>
    req<void>(`/api/circles/${cid}/checkins/${id}`, { method: "DELETE" }),
  checkinAudioUrl: (cid: string, id: string) =>
    req<{ url: string; expires_at: string }>(`/api/circles/${cid}/checkins/${id}/audio`),

  // care-signal
  careSignal: (cid: string) =>
    req<{ window: string[]; days: StripDay[] }>(`/api/circles/${cid}/care-signal`),

  // shifts
  shifts: (cid: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return req<any[]>(`/api/circles/${cid}/shifts${qs.toString() ? `?${qs}` : ""}`);
  },
  createShift: (cid: string, b: { starts_at: string; ends_at: string; caregiver_id?: string | null; purpose?: string; activity_tags?: string[]; coordinator_note?: string }) =>
    req<{ id: string }>(`/api/circles/${cid}/shifts`, { method: "POST", ...json(b) }),
  updateShift: (cid: string, id: string, b: Record<string, unknown>) =>
    req<{ id: string }>(`/api/circles/${cid}/shifts/${id}`, { method: "PATCH", ...json(b) }),
  deleteShift: (cid: string, id: string) =>
    req<void>(`/api/circles/${cid}/shifts/${id}`, { method: "DELETE" }),

  // plan + routine
  plan: (cid: string, date?: string) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/plan${date ? `?date=${date}` : ""}`),
  togglePlan: (cid: string, b: { date: string; key: string; done: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/plan/toggle`, { method: "POST", ...json(b) }),
  addAdhoc: (cid: string, b: { date?: string; title: string; time: string; category?: string; time_sensitive?: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/adhoc`, { method: "POST", ...json(b) }),
  deleteAdhoc: (cid: string, id: string) =>
    req<void>(`/api/circles/${cid}/adhoc/${id}`, { method: "DELETE" }),
  routine: (cid: string) => req<RoutineItem[]>(`/api/circles/${cid}/routine`),
  addRoutine: (cid: string, b: { title: string; time: string; category?: string; time_sensitive?: boolean; weekdays: number[] }) =>
    req<RoutineItem>(`/api/circles/${cid}/routine`, { method: "POST", ...json(b) }),
  updateRoutine: (cid: string, id: string, b: Record<string, unknown>) =>
    req<RoutineItem>(`/api/circles/${cid}/routine/${id}`, { method: "PATCH", ...json(b) }),
  deleteRoutine: (cid: string, id: string) =>
    req<void>(`/api/circles/${cid}/routine/${id}`, { method: "DELETE" }),

  // tts
  tts: async (text: string, lang = "en"): Promise<Blob> => {
    const token = await getToken();
    const res = await fetch(API_BASE + "/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) throw new ApiError(res.status, "tts failed");
    return res.blob();
  },
};
```

- [ ] **Step 2: Typecheck** — `npm --prefix frontend run typecheck`. Expect errors in `App.tsx` / `FileSidebar.tsx` (they call the old API). Those are fixed in Tasks 8–11. Commit `api.ts` alone now:

```bash
git add frontend/src/api.ts
git commit -m "feat(1c): api.ts — circle-scoped client + onboarding calls (App.tsx wiring follows)"
```

---

## Task 7: Frontend — active-circle context

**Files:**
- Create: `frontend/src/circle.tsx`

**Interfaces:**
- Produces:
  - `<CircleProvider>` — on mount calls `api.me()`; holds `{ me, activeCircle, loading, error, refresh }`. `activeCircle = me.circles[0] ?? null` (no switcher — wiring-map Q7).
  - `useCircle()` — hook returning the context; throws if used outside the provider.
  - `<RequireCircle>` — renders children only when `activeCircle` is set **and** `me.profile.tos_accepted_at` is set; otherwise renders `<PrivacyNotice>` (notice not accepted) or redirects to `/create-circle` (no circles). Per wiring-map Q6.

- [ ] **Step 1: Write `frontend/src/circle.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { api, type Me } from "./api";
import { PrivacyNotice } from "./onboarding/PrivacyNotice";

type Ctx = {
  me: Me | null;
  activeCircle: Me["circles"][number] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
const CircleCtx = createContext<Ctx | null>(null);

export function CircleProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setMe(await api.me()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeCircle = me?.circles[0] ?? null;
  return (
    <CircleCtx.Provider value={{ me, activeCircle, loading, error, refresh }}>
      {children}
    </CircleCtx.Provider>
  );
}

export function useCircle(): Ctx {
  const c = useContext(CircleCtx);
  if (!c) throw new Error("useCircle outside CircleProvider");
  return c;
}

export function RequireCircle({ children }: { children: ReactNode }) {
  const { me, activeCircle, loading } = useCircle();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!loading && me && me.circles.length === 0) navigate("/create-circle");
  }, [loading, me, navigate]);

  if (loading || !me) return null;
  if (!me.profile.tos_accepted_at) return <PrivacyNotice />;
  if (!activeCircle) return null; // navigate effect handles it
  return <>{children}</>;
}
```

- [ ] **Step 2: Typecheck** (will fail until Task 9 creates `PrivacyNotice`; commit together with Task 9). Skip commit here — proceed to Task 8.

---

## Task 8: Frontend — magic-link sign-in screen

**Files:**
- Create: `frontend/src/SignIn.tsx`

**Interfaces:**
- Consumes: `supabase`.
- Produces: `<SignIn>` — an email input + "Send me a link" button → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`; shows "check your email". Styled with the **existing** Tailwind tokens/classes used elsewhere in `App.tsx` (per wiring-map Q1 — no new visual language). If wiring-map Q1 kept a dev persona shortcut, add it behind `import.meta.env.DEV` only.

- [ ] **Step 1: Write `frontend/src/SignIn.tsx`**

```tsx
import { useState } from "react";
import { supabase } from "./supabaseClient";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  // NOTE: reuse the container / input / button classes already used on the
  // current sign-in screen in App.tsx — do not introduce new ones.
  if (sent) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p>Check your email for a sign-in link.</p>
      </div>
    );
  }
  return (
    <form onSubmit={send} className="mx-auto max-w-sm p-6 space-y-3">
      <label className="block text-sm font-medium" htmlFor="email">Email</label>
      <input
        id="email" type="email" required value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded border px-3 py-2"
        placeholder="you@example.com"
      />
      <button type="submit" disabled={busy} className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50">
        {busy ? "Sending…" : "Send me a link"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}
```

> **Executor:** before committing, open `App.tsx`, find the current sign-in markup, and swap the placeholder class names above for the real ones so this screen is visually indistinguishable from the current shell.

- [ ] **Step 2: Typecheck (partial) + hold commit for Task 11** (SignIn is mounted in `App.tsx` in Task 10).

---

## Task 9: Frontend — onboarding screens

**Files:**
- Create: `frontend/src/onboarding/PrivacyNotice.tsx`
- Create: `frontend/src/onboarding/CreateCircle.tsx`
- Create: `frontend/src/onboarding/AcceptInvite.tsx`

**Interfaces:**
- Produces:
  - `<PrivacyNotice>` — renders the notice text (imported from `docs/pilot-privacy-assessment.md`'s "Privacy notice v1" section, inlined as a constant) + an "I understand and agree" button → `api.acceptNotice(PRIVACY_NOTICE_VERSION)` → `useCircle().refresh()`.
  - `<CreateCircle>` — form (elder name, spoken language `<select>` with `ar` / `fr` / `en` / other, timezone prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`, **attestation checkbox**) → `api.createCircle({ …, attestation: true })` → `refresh()` → `navigate("/coordinator")`.
  - `<AcceptInvite>` — route `/invite/:token`; on mount `api.invitePreview(token)` → shows "`inviter_name` invited you to `circle_name` as `role`" + "Accept" → `api.acceptInvite(token)` → `refresh()` → `navigate(homeFor(role))`. If not signed in, render `<SignIn>` first (the token stays in the URL through the magic-link redirect).

- [ ] **Step 1: Write `frontend/src/onboarding/PrivacyNotice.tsx`**

```tsx
import { useState } from "react";
import { api } from "../api";
import { useCircle } from "../circle";

export const PRIVACY_NOTICE_VERSION = "2026-09-08";
const NOTICE = `Amanah stores your circle's care information — check-ins (including
short voice recordings and their transcripts), a care schedule, and task notes.
Voice recordings are sent to OpenAI in the United States for transcription.
You can ask to delete a circle and all its data at any time. See the full
privacy notice for details.`;

export function PrivacyNotice() {
  const { refresh } = useCircle();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-md p-6 space-y-4">
      <h1 className="text-lg font-semibold">Before you continue</h1>
      <p className="whitespace-pre-line text-sm">{NOTICE}</p>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); await api.acceptNotice(PRIVACY_NOTICE_VERSION); await refresh(); }}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        I understand and agree
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `frontend/src/onboarding/CreateCircle.tsx`**

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { api } from "../api";
import { useCircle } from "../circle";

export function CreateCircle() {
  const { refresh } = useCircle();
  const [, navigate] = useLocation();
  const [elderName, setElderName] = useState("");
  const [elderLang, setElderLang] = useState("ar");
  const [tz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [attest, setAttest] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createCircle({ elder_name: elderName.trim(), elder_lang: elderLang, timezone: tz, attestation: true });
      await refresh();
      navigate("/coordinator");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "could not create the circle");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md p-6 space-y-3">
      <h1 className="text-lg font-semibold">Set up a care circle</h1>
      <input className="w-full rounded border px-3 py-2" placeholder="Who are you caring for?"
        value={elderName} required onChange={(e) => setElderName(e.target.value)} />
      <select className="w-full rounded border px-3 py-2" value={elderLang}
        onChange={(e) => setElderLang(e.target.value)}>
        <option value="ar">Arabic</option><option value="fr">French</option>
        <option value="en">English</option><option value="other">Other</option>
      </select>
      <p className="text-sm text-gray-500">Time zone: {tz}</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} required />
        I am authorised to coordinate this person's care.
      </label>
      <button type="submit" disabled={busy || !attest}
        className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
        {busy ? "Creating…" : "Create circle"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Write `frontend/src/onboarding/AcceptInvite.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { api, type Role } from "../api";
import { useCircle } from "../circle";
import { homeFor } from "../session";
import { SignIn } from "../SignIn";
import { getToken } from "../session";

export function AcceptInvite() {
  const [, params] = useRoute("/invite/:token");
  const token = params?.token ?? "";
  const { refresh } = useCircle();
  const [, navigate] = useLocation();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<{ circle_name: string; inviter_name: string; role: Role } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getToken().then((t) => setSignedIn(!!t)); }, []);
  useEffect(() => {
    if (!token) return;
    api.invitePreview(token).then(setPreview).catch((e) => setErr(e.message));
  }, [token]);

  if (signedIn === false) return <SignIn />;
  if (err) return <div className="mx-auto max-w-sm p-6 text-sm text-red-600">{err}</div>;
  if (!preview) return null;

  return (
    <div className="mx-auto max-w-sm p-6 space-y-4">
      <p className="text-sm">
        <strong>{preview.inviter_name}</strong> invited you to <strong>{preview.circle_name}</strong> as {preview.role}.
      </p>
      <button
        className="rounded bg-black px-3 py-2 text-white"
        onClick={async () => {
          try {
            await api.acceptInvite(token);
            await refresh();
            navigate(homeFor(preview.role));
          } catch (e) { setErr(e instanceof Error ? e.message : "could not accept"); }
        }}
      >
        Accept
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + commit (Tasks 7–9 together)**

```bash
npm --prefix frontend run typecheck
git add frontend/src/circle.tsx frontend/src/SignIn.tsx frontend/src/onboarding
git commit -m "feat(1c): circle context + magic-link sign-in + onboarding screens"
```

---

## Task 10: Frontend — mount auth/onboarding routing in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx` (routing shell only — screens' internals in Task 11)
- Modify: `frontend/src/main.tsx` (wrap in `<CircleProvider>` if routing lives there)

**Interfaces:**
- Produces: `App` renders `<SignIn>` when signed out; when signed in, wraps the existing role routes in `<CircleProvider><RequireCircle>…</RequireCircle></CircleProvider>`, and adds routes `/create-circle` → `<CreateCircle>` and `/invite/:token` → `<AcceptInvite>` (the invite route is reachable while signed out).

- [ ] **Step 1: Read the current `App.tsx` shell**

```bash
grep -n "Switch\|Route\|useLocation\|getSession\|session\|SignIn\|login\|persona" frontend/src/App.tsx
```
Identify the top-level routing block and the current sign-in gate.

- [ ] **Step 2: Edit the shell**

Replace the sign-in gate with:
```tsx
import { onAuthChange } from "./session";
import { getToken } from "./session";
import { CircleProvider, RequireCircle } from "./circle";
import { SignIn } from "./SignIn";
import { CreateCircle } from "./onboarding/CreateCircle";
import { AcceptInvite } from "./onboarding/AcceptInvite";

// inside App():
const [authed, setAuthed] = useState<boolean | null>(null);
useEffect(() => {
  getToken().then((t) => setAuthed(!!t));
  return onAuthChange(setAuthed);
}, []);

if (authed === null) return null;

return (
  <Switch>
    <Route path="/invite/:token"><AcceptInvite /></Route>
    {!authed && <Route><SignIn /></Route>}
    {authed && (
      <Route>
        <CircleProvider>
          <Switch>
            <Route path="/create-circle"><CreateCircle /></Route>
            <Route>
              <RequireCircle>
                {/* existing role routes, unchanged markup, go here */}
              </RequireCircle>
            </Route>
          </Switch>
        </CircleProvider>
      </Route>
    )}
  </Switch>
);
```
Keep all existing role-route markup exactly as-is inside `<RequireCircle>`. Do not touch styles.

- [ ] **Step 3: Typecheck**

`npm --prefix frontend run typecheck` — remaining errors will be the role screens calling old `api.*` signatures. Fixed in Task 11.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx
git commit -m "feat(1c): App.tsx routing shell — magic-link gate + onboarding routes"
```

---

## Task 11: Frontend — repoint every screen's API calls to `:cid`

**Files:**
- Modify: `frontend/src/App.tsx` (screen internals)
- Delete or hide: `frontend/src/FileSidebar.tsx` (per wiring-map Q3)

**Interfaces:**
- Consumes: `useCircle()` → `activeCircle.id`.
- Produces: every `api.*` call inside a role screen passes `activeCircle.id` first; `api.myShift()` → `api.myShifts()`; the callout block and file sidebar handled per wiring-map Q2 / Q3; demo-reset per Q4; mood labels per Q5.

- [ ] **Step 1: Thread the circle id**

In each role screen component, add near the top:
```tsx
const { activeCircle } = useCircle();
const cid = activeCircle!.id; // RequireCircle guarantees it
```
Then, for every `api.X(...)` call in that component, change to `api.X(cid, ...)`. The full mapping is the per-screen table in the wiring map (Task 3 §2). Work screen by screen; typecheck after each.

- [ ] **Step 2: Apply the flagged-question decisions**

- **Q2 (callout):** if "remove" — delete the callout JSX block and its state; `api.careSignal(cid)` no longer returns `callout`. If "placeholder" — replace the value with the agreed static string.
- **Q3 (files):** if "remove" — delete the `<FileSidebar>` import + mount + its toggle button; `git rm frontend/src/FileSidebar.tsx`. If "hide" — wrap the mount in `{false && …}` with a code comment referencing Phase 2.
- **Q4 (demo reset):** remove the button + `api.resetDemo` call, or repoint to a "new demo circle" action per the answer.
- **Q5 (mood labels):** only if the user approved the `ok` → "OK" rename, change the label constant; otherwise leave untouched.

- [ ] **Step 3: Full typecheck + build**

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```
Both must pass with zero errors.

- [ ] **Step 4: Manual smoke against local**

```bash
# terminal 1
npx supabase start && npx supabase db reset
# terminal 2
npm --prefix server run dev
# terminal 3
npm --prefix frontend run dev
```
In a browser: sign in with a magic link (local Supabase logs the link to the `supabase` container — `npx supabase status` / inbucket at `http://127.0.0.1:54324`), accept the notice, create a circle, and confirm the elder / coordinator / family / caregiver screens render with **the same layout and styling as before** and load data. Note any visual drift and fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git rm frontend/src/FileSidebar.tsx   # only if wiring-map Q3 = remove
git commit -m "feat(1c): repoint all role screens to circle-scoped API; apply wiring-map decisions"
```

---

## Task 12: Nightly sweeper + backup workflows

**Files:**
- Create: `server/scripts/sweep-orphans.ts`
- Create: `server/scripts/backup.sh`
- Create: `server/scripts/restore-test.sh`
- Create: `.github/workflows/nightly.yml`

**Interfaces:**
- Produces:
  - `npm run sweep:orphans` → runs `sweepOrphans()` and logs the count.
  - `backup.sh` → `pg_dump "$DATABASE_URL_ADMIN"` to a timestamped file + `supabase storage cp -r ...` mirror of the `audio` bucket, both uploaded as workflow artifacts (retention 30 days) or to a backup bucket if `BACKUP_BUCKET_URL` is set.
  - `restore-test.sh` → spins a fresh local Supabase, `psql < dump`, runs `npm --prefix server run test:db -- integration/loop`.
  - `.github/workflows/nightly.yml` — cron `0 6 * * *` (06:00 UTC): job `sweep`, job `backup`.

- [ ] **Step 1: `server/scripts/sweep-orphans.ts`**

```ts
import "../src/loadEnv.js";
import { sweepOrphans } from "../src/storage/audio.js";

const { deleted } = await sweepOrphans(24);
console.log(`sweep-orphans: removed ${deleted} unreferenced audio object(s)`);
process.exit(0);
```
Add `"sweep:orphans": "tsx scripts/sweep-orphans.ts"` to `server/package.json`.

- [ ] **Step 2: `server/scripts/backup.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${BACKUP_DIR:-./backup}"
mkdir -p "$OUT"

echo "pg_dump -> $OUT/db-$STAMP.sql"
pg_dump "$DATABASE_URL_ADMIN" --no-owner --no-privileges > "$OUT/db-$STAMP.sql"

echo "mirror audio bucket -> $OUT/audio-$STAMP/"
supabase storage cp -r "ss:///audio" "$OUT/audio-$STAMP/" --experimental

echo "backup complete: $OUT/db-$STAMP.sql + $OUT/audio-$STAMP/"
```

- [ ] **Step 3: `server/scripts/restore-test.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
DUMP="${1:?usage: restore-test.sh <db-dump.sql>}"
supabase start
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "drop schema public cascade; create schema public;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" < "$DUMP"
NODE_ENV=test npm --prefix server run test:db -- integration/loop
echo "restore test passed against $DUMP"
```

- [ ] **Step 4: `.github/workflows/nightly.yml`**

```yaml
name: nightly
on:
  schedule: [{ cron: "0 6 * * *" }]
  workflow_dispatch:

jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - run: npm --prefix server ci
      - run: npm --prefix server run sweep:orphans
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          DATABASE_URL_ADMIN: ${{ secrets.DATABASE_URL_ADMIN }}

  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: bash server/scripts/backup.sh
        env:
          DATABASE_URL_ADMIN: ${{ secrets.DATABASE_URL_ADMIN }}
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          BACKUP_DIR: ./backup
      - uses: actions/upload-artifact@v4
        with: { name: nightly-backup, path: ./backup, retention-days: 30 }
```

- [ ] **Step 5: Commit**

```bash
chmod +x server/scripts/backup.sh server/scripts/restore-test.sh
git add server/scripts/sweep-orphans.ts server/scripts/backup.sh server/scripts/restore-test.sh server/package.json .github/workflows/nightly.yml
git commit -m "feat(1c): nightly orphan sweep + pg_dump/bucket backup + restore-test script"
```

---

## Task 13: API deploy config — Dockerfile + Fly

**Files:**
- Create: `server/Dockerfile`
- Create: `server/.dockerignore`
- Create: `server/fly.toml`

**Interfaces:**
- Produces: a container that runs `npm start` (`tsx src/index.ts`), health-checked at `/api/health`, Fly app `amanah-api`, `primary_region = "yul"`, 1 machine.

- [ ] **Step 1: `server/Dockerfile`**

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "start"]
```

- [ ] **Step 2: `server/.dockerignore`**

```
node_modules
audio/uploads
audio/tts
data.json
test
.env
.env.*
```

- [ ] **Step 3: `server/fly.toml`**

```toml
app = "amanah-api"
primary_region = "yul"

[build]

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  method = "GET"
  path = "/api/health"
  interval = "15s"
  timeout = "2s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 4: Commit**

```bash
git add server/Dockerfile server/.dockerignore server/fly.toml
git commit -m "chore(1c): API container + Fly config (yul, 1 machine, /api/health)"
```

---

## Task 14: One-time deploy runbook + CI deploy workflow

**Files:**
- Create: `docs/deploy.md`
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces:
  - `docs/deploy.md` — the manual first-time steps (Supabase project in `ca-central-1`; `supabase link`; set `[api].schemas` in the linked project's config; create the `app_authenticated` role + password in prod; `supabase db push`; `fly launch --no-deploy` then `fly secrets set …`; static host project + `VITE_*` env; point `CORS_ORIGIN` / `APP_ORIGIN` at the static origin).
  - `.github/workflows/deploy.yml` — on push to `main`: `supabase db push` → `flyctl deploy` → static build + deploy.

- [ ] **Step 1: Write `docs/deploy.md`**

Include, in order:
1. `supabase projects create amanah --region ca-central-1` (or via dashboard); capture project ref + DB password.
2. In the project's Postgres: `create role app_authenticated login password '<strong>' noinherit;` then re-run `supabase db push` (migrations `grant` to it).
3. `supabase link --project-ref <ref>`; ensure the linked `supabase/config.toml` `[api].schemas` still excludes `public`.
4. `supabase db push`.
5. `fly launch --no-deploy --copy-config --name amanah-api` from `server/`.
6. `fly secrets set OPENAI_API_KEY=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_JWT_SECRET=… DATABASE_URL='postgresql://app_authenticated:…@…:5432/postgres' DATABASE_URL_ADMIN='postgresql://postgres:…@…:5432/postgres' APP_ORIGIN=https://<static-domain> CORS_ORIGIN=https://<static-domain>`.
   > `DATABASE_URL` uses port **5432** (direct), never 6543.
7. `fly deploy`.
8. Static host: new project from `frontend/`, build `npm ci && npm run build`, output `dist/`, env `VITE_API_BASE=https://amanah-api.fly.dev`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
9. In Supabase Auth settings: add the static domain to the redirect allow-list.
10. GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `FLY_API_TOKEN`, plus the nightly job's `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL_ADMIN`.

- [ ] **Step 2: Write `.github/workflows/deploy.yml`**

```yaml
name: deploy
on:
  push:
    branches: [main]

concurrency: { group: deploy, cancel-in-progress: false }

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env: { SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }} }
      - run: supabase db push
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}

  api:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --config server/fly.toml
        env: { FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }} }

  frontend:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - run: npm --prefix frontend ci
      - run: npm --prefix frontend run build
        env:
          VITE_API_BASE: https://amanah-api.fly.dev
          VITE_SUPABASE_URL: ${{ secrets.PROD_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.PROD_SUPABASE_ANON_KEY }}
      # then: deploy frontend/dist with the static host's action (Vercel/CF Pages)
      - run: echo "wire the static-host deploy action here per docs/deploy.md step 8"
```

- [ ] **Step 3: Commit**

```bash
git add docs/deploy.md .github/workflows/deploy.yml
git commit -m "chore(1c): deploy runbook + CI deploy (db push -> fly -> static)"
```

---

## Task 15: The pre-pilot privacy assessment (D19 gate)

**Files:**
- Create: `docs/pilot-privacy-assessment.md`

**Interfaces:**
- Produces: the document that gates onboarding a real family (§12, D19). Not code. This task is complete when the doc is filled in with real answers — placeholders are a task failure.

- [ ] **Step 1: Write `docs/pilot-privacy-assessment.md`** with these sections, each filled in:

1. **Data inventory** — a table: data element → where stored (`checkins`, `checkin_content`, Supabase Storage `audio`, `profiles`, …) → retention (until circle deletion) → who can see it (the §5 tier).
2. **Cross-border transfer assessment (OpenAI, US)** — what leaves Québec (voice bytes + transcript text to `api.openai.com`), the legal basis relied on for the pilot (explicit informed consent captured at sign-up), the safeguard (OpenAI API data-use terms: not used for training; 30-day retention), and the residual risk statement.
3. **Consent & authority** — the sign-up privacy-notice text (v1, matches `PrivacyNotice.tsx` `NOTICE` + `PRIVACY_NOTICE_VERSION`), and the coordinator authority attestation wording (matches `CreateCircle.tsx`).
4. **Access & deletion** — how a person requests deletion, the two paths (circle delete = `DELETE /api/circles/:cid` → row cascade + `deleteCircleAudio`; person-level = per spec §4), and the target turnaround (7 days).
5. **Retention & backups** — nightly `pg_dump` + `audio` mirror, 30-day artifact retention, restore-test cadence (quarterly + pre-pilot).
6. **Residual risks accepted for the pilot** — process compromise of the Fly host bypasses RLS (both pools live there); no audit log; single API instance.
7. **Sign-off** — a line for the project owner to date and initial. **Until this line is signed, no real elder data enters the system.**

- [ ] **Step 2: Cross-check against the code**

Confirm `PRIVACY_NOTICE_VERSION` in `frontend/src/onboarding/PrivacyNotice.tsx` equals the version named in §3 of this doc, and that the notice text matches. Fix whichever is stale.

- [ ] **Step 3: Deliver to the user for sign-off + commit**

```bash
git add docs/pilot-privacy-assessment.md
git commit -m "docs(1c): pre-pilot privacy assessment (D19 gate) — owner sign-off pending"
```
Send the file to the user. State: **the pilot cannot onboard a real family until the sign-off line is dated.**

---

## Self-Review

**1. Spec coverage (§9, §10, §12, §13, backup parts of §11):**

| Spec element | Task |
|---|---|
| Private `audio` bucket, deny direct access (§9) | 1 |
| `uploadStaging` / `promoteStaging` / `signedUrl` (120 s) / `deleteCircleAudio` (§9) | 2 |
| Staging path prefix + move-on-save (§7/§9 — consumed from 1b) | 2 |
| Orphan sweeper, staging + promoted, 24 h, `service_role` (§9) | 2, 12 |
| Frontend wired to new API + magic-link auth, **visuals unchanged**, wiring map first (§13) | 3–11 |
| No clinical-files UI, no switcher UI (D16) | 3 (Q3/Q7), 11 |
| Magic-link only sign-in (§6, D17) | 5, 8 |
| Onboarding screens: notice, create-circle + attestation, invite accept (§6) | 9 |
| Active-circle context = `circles[0]` (D16) | 7 |
| Supabase `ca-central-1`; Fly `yul`, 1 instance; static host (§10) | 13, 14 |
| `DATABASE_URL` direct 5432 (§10, D20) | 14 (runbook step 6) |
| Migrations via `supabase db push` in CI; deploy on `main` (§10) | 14 |
| Nightly `pg_dump` **+ audio bucket** + restore test, GitHub Actions-owned (§10, §11) | 12 |
| Region is data-minimisation, not a compliance claim (§10/§12, D10) | 15 (§2 of the doc) |
| Pre-pilot privacy assessment as a hard gate (§12, D19) | 15 |
| OpenAI US transfer disclosure + assessment (§12, S1) | 9 (notice text), 15 (§2) |
| Consent capture + withdrawal path (§12, S2) | 9, 15 (§3, §4) |

No gaps.

**2. Placeholder scan:** the only intentionally-deferred items are the **user's** wiring-map answers (Task 3, gated) and the static-host deploy action (Task 14 step 2 — host-specific, named in `docs/deploy.md` step 8). Task 15's doc must be filled with real content — flagged as a task failure if not.

**3. Type consistency:** `api.*` method names in `api.ts` (Task 6) are used verbatim in Tasks 9–11 and match the Part 1b routes (`/api/circles/:cid/...`). `useCircle()` / `activeCircle.id` (Task 7) is the single source of `cid` in Task 11. Storage function names (`uploadStaging`, `promoteStaging`, `signedUrl`, `deleteCircleAudio`, `sweepOrphans`) in Task 2 match the Part 1b stub signatures and the Task 12 sweeper import. `PRIVACY_NOTICE_VERSION` is defined once (Task 9) and cross-checked in Task 15.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-amanah-mvp-1c-storage-frontend-deploy.md`. This is **Part 1c of 3** — requires Parts 1a and 1b merged and green. **Task 3 is a hard gate: deliver the wiring map and wait for the user's answers before any frontend code (Tasks 5–11).**

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks; pause at Task 3 for the user.
2. **Inline Execution** — executing-plans, batch with checkpoints; stop at Task 3.

Which approach?

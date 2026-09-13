# Deploy runbook

One-time manual setup for the first deploy, plus what `.github/workflows/deploy.yml`
automates on every push to `main` after that. Nothing here has been run yet — Amanah
is not deployed as of this writing (see README's Honest status section).

## Prerequisites

- `supabase` CLI (`npx supabase`), a Supabase account, `flyctl`, a Fly.io account.
- A static-hosting account (Vercel, Cloudflare Pages, or similar) for the frontend build.
- An OpenAI API key (voice features).

## One-time manual steps

1. **Create the Supabase project** (`ca-central-1` — closest region to `yul`, and the
   region choice matters for the pilot's data-residency posture — see
   `docs/pilot-privacy-assessment.md`, Task 15):
   ```bash
   supabase projects create amanah --region ca-central-1
   ```
   or via the dashboard. Capture the project ref and the generated DB password —
   the CLI only shows the password once.

2. **Create the restricted `app_authenticated` role in prod Postgres.** This project's
   entire authorization model depends on the API connecting as this role, never as
   `postgres` — see HANDOFF's security invariants. Connect to the new project's
   Postgres (SQL editor in the dashboard, or `psql` against the connection string) and run:
   ```sql
   create role app_authenticated login password '<strong-password>' noinherit;
   ```
   Migration `20260908000015_lockdown_grants.sql` grants this role its actual table
   privileges — that grant only takes effect once the role exists, so this step must
   happen before `db push`, not after.

3. **Link and push migrations:**
   ```bash
   supabase link --project-ref <ref>
   ```
   Before pushing, confirm the linked project's `supabase/config.toml` still has
   `[api].schemas` excluding `public` (PostgREST must never see the tenant tables
   directly — RLS-gated access goes through this API server, not PostgREST).
   ```bash
   supabase db push
   ```

4. **Launch the Fly app** (from `server/`, using the committed `fly.toml`):
   ```bash
   cd server
   fly launch --no-deploy --copy-config --name amanah-api
   ```

5. **Set Fly secrets:**
   ```bash
   fly secrets set \
     OPENAI_API_KEY=… \
     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=… \
     SUPABASE_JWT_SECRET=… \
     DATABASE_URL='postgresql://app_authenticated:<password>@db.<ref>.supabase.co:5432/postgres' \
     DATABASE_URL_ADMIN='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
     APP_ORIGIN=https://<static-domain> \
     CORS_ORIGIN=https://<static-domain>
   ```
   > `DATABASE_URL` and `DATABASE_URL_ADMIN` use port **5432** (direct connection),
   > never 6543 (the pooler) — this app holds long-lived transactions
   > (`withUserTxn`/`withAdminTxn`) that a transaction-mode pooler will break.

6. **Deploy the API:**
   ```bash
   fly deploy
   ```

7. **Static-host the frontend.** New project pointed at `frontend/`, build command
   `npm ci && npm run build`, output directory `dist/`. Env vars:
   - `VITE_API_BASE=https://amanah-api.fly.dev`
   - `VITE_SUPABASE_URL=https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<anon key>`

8. **Add the static domain to Supabase Auth's redirect allow-list** (dashboard →
   Authentication → URL Configuration) — the magic-link email's link redirects here;
   without this the link 400s.

9. **GitHub repo secrets**, for `.github/workflows/deploy.yml` and `nightly.yml`:
   - `SUPABASE_ACCESS_TOKEN` (`supabase login` token, or a generated access token)
   - `SUPABASE_DB_PASSWORD`
   - `SUPABASE_PROJECT_REF`
   - `FLY_API_TOKEN`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL_ADMIN` (nightly job)
   - `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY` (frontend build)

10. **Set the `DEPLOYED` repository variable to `true`** (Settings → Actions → Variables,
    not Secrets — `nightly.yml`'s jobs read it as `vars.DEPLOYED`). Both `sweep` and
    `backup` are gated on this and silently skip otherwise — without it, the nightly
    cron would have started failing every night from the moment `nightly.yml` merged,
    since the secrets it needs don't exist until this step. Do this only once the
    steps above are actually done — the guard exists specifically so this isn't set
    prematurely.

11. **Wire the frontend static-host deploy action into `.github/workflows/deploy.yml`**
    (the `frontend` job below ends in a placeholder `echo` — replace it with the
    chosen host's official deploy action, e.g. `amondnet/vercel-action` or
    `cloudflare/pages-action`, once the host is chosen in step 7).

12. **Restrict the database to Fly's network** (recommended — closes part of the
    "a compromised host bypasses RLS entirely" risk named in
    `docs/pilot-privacy-assessment.md` §6: this doesn't remove that risk, but it
    means the *only* thing on the internet that can even attempt a raw Postgres
    connection is the Fly app itself, not anyone who obtains the connection
    string some other way). Supabase's
    [Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions)
    feature enforces an IP allowlist on Postgres/pooler connections before
    traffic reaches the database — note it does *not* cover the HTTPS APIs
    (PostgREST/Storage/Auth), only direct Postgres, which is exactly what
    `DATABASE_URL`/`DATABASE_URL_ADMIN` use:
    ```bash
    # From server/, once `fly launch` (step 5) has created the app: allocate a
    # dedicated (static) IPv4 so there's a fixed address to allowlist — Fly's
    # default shared IP is not stable enough to allowlist.
    fly ips allocate-v4
    fly ips list          # note the dedicated v4 address
    ```
    Then, in the Supabase dashboard: Project Settings → Database → Network
    Restrictions → add that address as a `/32` CIDR (and the project's own
    Postgres/pooler default is otherwise "open" until you add at least one
    restriction, so this step has no effect until done). Do this *after*
    confirming `fly deploy` (step 7) actually works end-to-end — locking the
    database down before the app can reach it turns a config mistake into a
    full outage instead of a clear error.

    **This will break `.github/workflows/nightly.yml`'s `sweep` and `backup`
    jobs if you apply it as-is.** Both connect directly to Postgres using
    `DATABASE_URL_ADMIN` (`sweepOrphans()` via `adminPool`, and `pg_dump` in
    `server/scripts/backup.sh`) — but they run on GitHub-hosted Actions
    runners, whose IPs are ephemeral and shared across every GitHub Actions
    job on the platform, not the Fly app's dedicated address. There is no
    stable IP to allowlist for them, and allowlisting GitHub's entire published
    Actions IP range would defeat the point of this step (it's enormous and
    shared with every other GitHub customer's workflows). Two real choices,
    not a step to skip past:
    - **Move nightly `sweep`/`backup` off GitHub Actions onto something running
      inside Fly's network** — e.g. a [Fly Machines scheduled
      run](https://fly.io/docs/machines/flyctl/fly-machine-run/#schedule) instead
      of a GitHub Actions cron — so they share the same allowlisted IP as the API
      itself. This is the architecturally correct fix and the one to actually do
      before relying on this pilot for real; it's real work (rewriting how these
      two jobs are triggered), not done as part of this branch.
    - **Or**: don't apply this network restriction while nightly.yml stays on
      GitHub Actions, and accept the "host compromise bypasses RLS" residual
      risk (§6) as-is for now. A silently-broken nightly backup, discovered only
      when you actually need to restore from one, is a worse outcome than not
      having applied this hardening step yet.

    Whichever you choose, don't apply the restriction and walk away — verify
    the very next scheduled `nightly` run actually succeeds
    (`gh run list --workflow=nightly.yml`), not just that `fly deploy` still
    works.

## What CI automates after that

On every push to `main`, `.github/workflows/deploy.yml` runs, in order:
`supabase db push` → `flyctl deploy` (API) and, in parallel, the frontend build
(static-host deploy still needs step 11 wired in).

## Rollback

- **API**: `fly releases` then `fly deploy --image <previous-image-ref>`, or
  `fly apps restart` after a `fly deploy` of a reverted commit.
- **Database**: migrations are forward-only by convention in this project (no `down`
  migrations exist) — a bad migration is fixed by writing a new corrective migration,
  not by rolling back. For a genuine emergency, `server/scripts/restore-test.sh`
  documents the restore path from a `backup.sh` dump (nightly artifact, 30-day
  retention) — restoring prod from that dump is a manual, deliberate operation, not
  automated here on purpose.
- **Frontend**: redeploy the previous build from the static host's own history/rollback
  UI.

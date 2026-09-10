-- app_authenticated should be able to resolve auth.uid() from a plpgsql body
-- (SECURITY INVOKER functions in Part 1b) — mirroring Supabase's own
-- `authenticated` role. Without it, any INVOKER trigger/helper that calls
-- auth.uid() raises 42501 (the class of bug fixed ad hoc in 44a3b3b).
--
-- Policy quals are unaffected either way: they are parse-analysed as postgres
-- at CREATE POLICY time, so no invoker-side ACL check happens at query time.
-- That accident is why the missing grant was invisible.
--
-- !! MEASURED CAVEAT — these four statements are NO-OPS on the Supabase CLI
-- stack. Migrations run as `postgres`, which is neither the owner of schema
-- `auth` (owner: supabase_admin, a superuser `postgres` cannot SET ROLE to)
-- nor the owner of auth.uid/role/email (owner: supabase_auth_admin), and holds
-- no GRANT OPTION on either. Each statement therefore emits
-- `WARNING: no privileges were granted` and changes nothing. They are kept
-- because they ARE correct and effective on a stack where the migration role
-- owns `auth` (self-hosted), and because they document the intent.
--
-- The two ways to actually close this, neither of which 1a takes unilaterally:
--   (a) an operator runs `grant usage on schema auth to app_authenticated;`
--       as supabase_admin, out of band; or
--   (b) 1b keeps the 44a3b3b pattern — any helper that needs the claim is
--       SECURITY DEFINER owned by postgres (which does hold USAGE on auth).
-- `grant authenticated to app_authenticated` is NOT an option: `authenticated`
-- carries SELECT on nine storage.* tables, so it would widen the API pool's
-- surface into storage, which spec §3 deliberately excludes. (D13)
grant usage on schema auth to app_authenticated;
grant execute on function auth.uid() to app_authenticated;
grant execute on function auth.role() to app_authenticated;
grant execute on function auth.email() to app_authenticated;

-- Make the residual gap LOUD rather than silently "applied". A warning, not an
-- exception: `db reset` must stay clean, and (b) above is a valid posture.
do $$
begin
  if not has_schema_privilege('app_authenticated', 'auth', 'usage') then
    raise warning using message =
      'app_authenticated still lacks USAGE on schema auth: the GRANT above was '
      'a no-op because the migration role does not own it. SECURITY INVOKER '
      'code in 1b must not call auth.uid() directly — see this file''s header.';
  end if;
end $$;

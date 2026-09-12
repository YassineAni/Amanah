-- Private bucket. No policies for anon/authenticated on storage.objects, so
-- only service_role (the API) can read or write. Downloads happen through
-- the API as 120s signed URLs after an RLS check on checkin_content. (§9)
--
-- Filename note: the 1c plan drafted this as
-- 20260908000016_storage_audio_bucket.sql, but that slot is already taken by
-- 20260908000016_auth_schema_grant.sql (Part 1a). Using the next real slot
-- in the scheme established in Part 1b (20260911000001_profiles_column_scope.sql).
--
-- do update (not do nothing): if the bucket already exists — e.g. someone
-- created it via Studio before this migration ran — force it private rather
-- than leaving a pre-existing public=true bucket untouched.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do update set public = false;

-- Belt-and-braces: make sure no permissive policy exists on storage.objects.
-- This is a one-time sweep at migration-apply time, not a standing
-- invariant — it does not prevent a policy being added afterward (e.g.
-- via Studio, or a careless future migration). test/db/storage-lockdown
-- pins this as an ongoing, CI-enforced check instead of relying on this
-- comment alone.
--
-- Checked by ROLE, not by matching bucket_id text in qual/with_check.
-- An earlier version of this migration matched a literal
-- `bucket_id = 'audio'` string — that missed two real cases: (a) a policy
-- with no scoping predicate at all (`using (true)`), which still applies to
-- every bucket including this one, and (b) a policy created with no `TO`
-- clause, which PostgreSQL reports as `roles = {public}`, not
-- `{anon,authenticated}` — verified empirically, both slip past a
-- role-name check that only lists `anon`/`authenticated` explicitly.
-- `public` covers every role (anon, authenticated, service_role, ...), so
-- checking for it directly closes that gap. The design intent stated above
-- ("only service_role") means this bucket-agnostic check is actually the
-- correct invariant for this table today — there is exactly one bucket,
-- and nothing should ever grant anon/authenticated/public access to it.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (roles && array['anon', 'authenticated', 'public']::name[])
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

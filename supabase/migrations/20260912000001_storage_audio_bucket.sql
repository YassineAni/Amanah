-- Private bucket. No policies for anon/authenticated on storage.objects, so
-- only service_role (the API) can read or write. Downloads happen through
-- the API as 120s signed URLs after an RLS check on checkin_content. (§9)
--
-- Filename note: the 1c plan drafted this as
-- 20260908000016_storage_audio_bucket.sql, but that slot is already taken by
-- 20260908000016_auth_schema_grant.sql (Part 1a). Using the next real slot
-- in the scheme established in Part 1b (20260911000001_profiles_column_scope.sql).
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

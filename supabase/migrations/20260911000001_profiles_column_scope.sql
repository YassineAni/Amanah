-- Carried over from Part 1a's final adversarial review (HANDOFF.md NEW-1,
-- assigned to land "at the same time you wire PATCH /api/me / POST
-- /api/me/accept-notice" -- Part 1b Task 6). upd_profiles (migration 008)
-- has no column scope: a user could rewrite their own email to another
-- user's exact address (no unique index on profiles.email), full_name
-- (denormalised into doneByName/addedByName attribution strings, spec §8),
-- or created_at. Nothing in 1a reads profiles.email in a policy/function
-- body and no 1b handler resolves identity by it either (auth is always
-- claims.sub / claims.email from the verified JWT), so this was not
-- exploitable, but it is new mutable surface on a column the spec calls a
-- mirror of auth.users, and the smallest fix is one column-scope trigger,
-- the same allow-list shape as the three migration 013 already has
-- (invariant #8): raise unless only the permitted columns (+ updated_at)
-- differ.
create or replace function app.profiles_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Admin-pool writes (onboarding, invite accept, seed) carry no JWT claims
  -- -> auth.uid() is null. Those paths are trusted; do not clamp them.
  if (select auth.uid()) is null then
    return new;
  end if;
  -- ALLOW-LIST: ui_lang / tos_accepted_at / privacy_notice_version (+
  -- updated_at, set by the touch trigger). id/email/created_at are frozen
  -- to close the identity-spoof surface above. full_name is frozen too --
  -- the spec has no "edit your name" endpoint, so freezing it costs
  -- nothing and closes the roster-spoof angle on the same attribution
  -- strings.
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.full_name is distinct from old.full_name
     or new.created_at is distinct from old.created_at then
    raise exception 'only ui_lang / tos_accepted_at / privacy_notice_version may change on a profile';
  end if;
  return new;
end $$;
create trigger profiles_column_scope before update on public.profiles
  for each row execute function app.profiles_column_scope();

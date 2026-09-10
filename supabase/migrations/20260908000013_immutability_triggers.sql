-- Freeze circle_id + attribution columns on the domain tables. ----------
create or replace function app.freeze_attribution()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id then
    raise exception 'circle_id is immutable';
  end if;
  return new;
end $$;

create or replace function app.freeze_checkins_recorder()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id
     or new.recorded_by is distinct from old.recorded_by
     or new.is_proxy is distinct from old.is_proxy then
    raise exception 'circle_id / recorded_by / is_proxy are immutable';
  end if;
  return new;
end $$;

create trigger freeze_checkins       before update on public.checkins       for each row execute function app.freeze_checkins_recorder();
create trigger freeze_shifts         before update on public.shifts         for each row execute function app.freeze_attribution();
create trigger freeze_routine_items  before update on public.routine_items  for each row execute function app.freeze_attribution();

create or replace function app.freeze_authored_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.circle_id is distinct from old.circle_id then
    raise exception 'circle_id is immutable';
  end if;
  if tg_table_name = 'completions' and new.done_by is distinct from old.done_by then
    raise exception 'done_by is immutable';
  end if;
  if tg_table_name = 'adhoc_tasks' and new.added_by is distinct from old.added_by then
    raise exception 'added_by is immutable';
  end if;
  return new;
end $$;
create trigger freeze_completions before update on public.completions for each row execute function app.freeze_authored_by();
create trigger freeze_adhoc       before update on public.adhoc_tasks for each row execute function app.freeze_authored_by();

-- A saved check-in's UPDATE may change visibility ONLY. (spec §5) ---------
-- ALLOW-LIST, not an exclusion list: everything except {visibility,
-- updated_at} is guarded explicitly, so an unlisted column is immutable by
-- default. (As an exclusion list, `created_at` and `id` were writable — an
-- audit-trail rewrite.)
create or replace function app.checkins_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.circle_id is distinct from old.circle_id
     or new.occurred_on is distinct from old.occurred_on
     or new.mood is distinct from old.mood
     or new.spoken_lang is distinct from old.spoken_lang
     or new.recorded_by is distinct from old.recorded_by
     or new.is_proxy is distinct from old.is_proxy
     or new.created_via is distinct from old.created_via
     or new.created_at is distinct from old.created_at then
    raise exception 'only visibility may change on a saved check-in';
  end if;
  return new;
end $$;
create trigger checkins_column_scope before update on public.checkins
  for each row execute function app.checkins_column_scope();

-- checkin_content: copy the denormalized columns from the parent at insert,
-- freeze them on update EXCEPT visibility, which tracks a parent change. --
create or replace function app.checkin_content_denorm()
returns trigger language plpgsql set search_path = '' as $$
declare parent public.checkins;
begin
  select * into parent from public.checkins where id = new.checkin_id;
  if not found then
    raise exception 'checkin_content.checkin_id % has no parent', new.checkin_id;
  end if;
  if tg_op = 'INSERT' then
    new.circle_id   := parent.circle_id;
    new.visibility  := parent.visibility;
    new.recorded_by := parent.recorded_by;
    new.is_proxy    := parent.is_proxy;
  else
    if new.checkin_id is distinct from old.checkin_id then
      raise exception 'checkin_id is immutable on checkin_content';
    end if;
    if new.circle_id is distinct from old.circle_id
       or new.recorded_by is distinct from old.recorded_by
       or new.is_proxy is distinct from old.is_proxy
       or new.created_at is distinct from old.created_at then
      raise exception 'circle_id / recorded_by / is_proxy / created_at are immutable on checkin_content';
    end if;
    -- visibility may only move in lockstep with the parent
    new.visibility := parent.visibility;
  end if;
  return new;
end $$;
create trigger denorm_checkin_content
  before insert or update on public.checkin_content
  for each row execute function app.checkin_content_denorm();

-- Caregiver's shifts UPDATE: only the two visit-verification columns. ----
create or replace function app.shifts_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Admin-pool writes (seed, migrations) carry no JWT claims -> auth.uid()
  -- is null. Those paths are trusted; do not apply the caregiver clamp.
  if (select auth.uid()) is null then
    return new;
  end if;
  if app.circle_role(new.circle_id) = 'coordinator' then
    return new;  -- coordinator may change anything the policy allowed
  end if;
  -- ALLOW-LIST: a caregiver may touch only {checked_in_at, checked_out_at}
  -- (+ updated_at, set by the touch trigger). Everything else is guarded
  -- explicitly so a column added in 1b/1c is immutable by default.
  if new.id is distinct from old.id
     or new.circle_id is distinct from old.circle_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.caregiver_id is distinct from old.caregiver_id
     or new.purpose is distinct from old.purpose
     or new.activity_tags is distinct from old.activity_tags
     or new.coordinator_note is distinct from old.coordinator_note
     or new.created_at is distinct from old.created_at then
    raise exception 'a caregiver may only change checked_in_at / checked_out_at';
  end if;
  return new;
end $$;
create trigger shifts_column_scope before update on public.shifts
  for each row execute function app.shifts_column_scope();

-- Coordinator's circle_members UPDATE: only removed_at. The admin pool
-- (invite acceptance un-removing a soft-removed member, which also rewrites
-- role / is_family_member) runs with no claims -> auth.uid() null -> trusted.
create or replace function app.circle_members_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  -- ALLOW-LIST: only {removed_at, updated_at} may differ. (As an exclusion
  -- list, `joined_at` / `id` / `created_at` were writable.)
  if new.id is distinct from old.id
     or new.circle_id is distinct from old.circle_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.is_family_member is distinct from old.is_family_member
     or new.invited_by is distinct from old.invited_by
     or new.joined_at is distinct from old.joined_at
     or new.created_at is distinct from old.created_at then
    raise exception 'only removed_at may change on circle_members';
  end if;
  return new;
end $$;
create trigger circle_members_column_scope before update on public.circle_members
  for each row execute function app.circle_members_column_scope();

-- circles.elder_user_id must match the active elder membership. ----------
create or replace function app.assert_elder_consistency()
returns trigger language plpgsql security definer set search_path = '' as $$
declare elder_membership uuid;
begin
  select m.user_id into elder_membership
  from public.circle_members m
  where m.circle_id = coalesce(new.id, old.id)
    and m.role = 'elder' and m.removed_at is null
  limit 1;
  -- resolve which row we are validating
  if tg_table_name = 'circles' then
    if new.elder_user_id is distinct from elder_membership then
      raise exception 'circles.elder_user_id (%) must equal the active elder membership (%)',
        new.elder_user_id, elder_membership;
    end if;
  end if;
  return new;
end $$;
create constraint trigger circles_elder_consistency
  after update of elder_user_id on public.circles
  deferrable initially deferred
  for each row execute function app.assert_elder_consistency();

-- ...and the other half of the same invariant: soft-removing the elder's
-- membership must clear circles.elder_user_id, or the circle keeps pointing at
-- a user who has no elder membership. Nothing watched circle_members before.
-- SECURITY DEFINER (owner postgres): circles deliberately has NO UPDATE policy
-- for app_authenticated, so an INVOKER function could not write it. No auth.*
-- in the body; every identifier is public.-qualified.
create or replace function app.sync_elder_on_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.circles set elder_user_id = null where id = old.circle_id;
  return null;
end $$;

create trigger circle_members_sync_elder
  after update of removed_at on public.circle_members
  for each row
  when (old.role = 'elder' and old.removed_at is null and new.removed_at is not null)
  execute function app.sync_elder_on_removal();

-- checkin_content.visibility is the column that actually gates disclosure
-- (D12), and it only ever re-synced when the CHILD was updated — so a parent
-- visibility change left the child on the old tier. Enforce the lockstep in
-- the DB rather than relying on 1b issuing both statements. (D6)
-- SECURITY DEFINER (owner postgres): must write past checkin_content's tier
-- policy. The child UPDATE fires denorm_checkin_content, which re-reads the
-- parent and assigns the SAME value — a no-op, and no further cascade.
create or replace function app.propagate_checkin_visibility()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.checkin_content
     set visibility = new.visibility
   where checkin_id = new.id;
  return null;
end $$;

create trigger checkins_propagate_visibility
  after update of visibility on public.checkins
  for each row
  when (old.visibility is distinct from new.visibility)
  execute function app.propagate_checkin_visibility();

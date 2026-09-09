create or replace function app.guard_member_removal()
returns trigger language plpgsql set search_path = '' as $$
declare
  owner uuid;
  remaining_coordinators int;
begin
  -- only fire on an actual removal
  if old.removed_at is not null or new.removed_at is null then
    return new;
  end if;

  -- serialise all removals for this circle
  perform 1 from public.circles c where c.id = old.circle_id for update;

  select o.owner_user_id into owner
  from public.circles c join public.organizations o on o.id = c.org_id
  where c.id = old.circle_id;

  if old.user_id = owner then
    raise exception 'cannot remove the organization owner from their circle';
  end if;

  if old.role = 'coordinator' then
    select count(*) into remaining_coordinators
    from public.circle_members m
    where m.circle_id = old.circle_id
      and m.role = 'coordinator'
      and m.removed_at is null
      and m.id <> old.id;
    if remaining_coordinators = 0 then
      raise exception 'cannot remove the last coordinator of a circle';
    end if;
  end if;

  return new;
end $$;

create trigger guard_member_removal
  before update on public.circle_members
  for each row execute function app.guard_member_removal();

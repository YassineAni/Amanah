-- Membership truth. SECURITY DEFINER + owned by postgres (BYPASSRLS) so a
-- policy on circle_members that calls is_member() does not recurse into
-- its own policy. STABLE: one evaluation per statement per argument.
-- search_path = '' forces every identifier to be schema-qualified. (D14)

create or replace function app.is_member(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = circle
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  );
$$;

create or replace function app.circle_role(circle uuid)
returns circle_role language sql stable security definer set search_path = '' as $$
  select m.role from public.circle_members m
  where m.circle_id = circle
    and m.user_id = (select auth.uid())
    and m.removed_at is null
  limit 1;
$$;

create or replace function app.is_family(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.is_family_member from public.circle_members m
    where m.circle_id = circle
      and m.user_id = (select auth.uid())
      and m.removed_at is null
    limit 1
  ), false);
$$;

create or replace function app.is_org_owner(circle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.circles c
    join public.organizations o on o.id = c.org_id
    where c.id = circle
      and o.owner_user_id = (select auth.uid())
  );
$$;

-- app_authenticated must be able to call them
grant execute on function app.is_member(uuid)     to app_authenticated;
grant execute on function app.circle_role(uuid)   to app_authenticated;
grant execute on function app.is_family(uuid)     to app_authenticated;
grant execute on function app.is_org_owner(uuid)  to app_authenticated;

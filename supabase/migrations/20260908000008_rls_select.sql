-- Enable + FORCE on every tenant table (FORCE so even the table owner is
-- subject to RLS; the API pool is app_authenticated, never the owner).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','organizations','circles','circle_members','invites',
    'checkins','checkin_content','shifts','routine_items','completions','adhoc_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Circle-scoped tables with NO per-row visibility model: a member sees all
-- rows for their circles. Every /api/circles/:cid handler ALSO filters
-- circle_id = :cid in SQL (spec §5) — RLS is the safety net, not the scope.
create policy sel_checkins     on public.checkins        for select to app_authenticated using (app.is_member(circle_id));
create policy sel_shifts       on public.shifts          for select to app_authenticated using (app.is_member(circle_id));
create policy sel_routine      on public.routine_items   for select to app_authenticated using (app.is_member(circle_id));
create policy sel_completions  on public.completions     for select to app_authenticated using (app.is_member(circle_id));
create policy sel_adhoc        on public.adhoc_tasks     for select to app_authenticated using (app.is_member(circle_id));
create policy sel_circles      on public.circles         for select to app_authenticated using (app.is_member(id));
create policy sel_circle_members on public.circle_members for select to app_authenticated using (app.is_member(circle_id));
create policy sel_invites      on public.invites         for select to app_authenticated using (app.is_member(circle_id));

-- organizations: the owner, OR any member of one of its circles (so invited
-- staff can read is_demo for GET /api/me). (spec §5 / C8)
create policy sel_organizations on public.organizations for select to app_authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (
      select 1 from public.circles c
      where c.org_id = organizations.id and app.is_member(c.id)
    )
  );

-- profiles: yourself, or anyone who shares a circle with you.
create policy sel_profiles on public.profiles for select to app_authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.circle_members me
      join public.circle_members them on them.circle_id = me.circle_id
      where me.user_id = (select auth.uid()) and me.removed_at is null
        and them.user_id = public.profiles.id and them.removed_at is null
    )
  );

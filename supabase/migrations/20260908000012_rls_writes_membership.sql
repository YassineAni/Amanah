-- circle_members: a coordinator may UPDATE (trigger 013 limits the change
-- to removed_at; trigger 014 blocks removing the owner or the last
-- coordinator). No INSERT / DELETE policy -> only a BYPASSRLS connection
-- (the API's admin pool, on invite acceptance) can add rows.
create policy upd_circle_members on public.circle_members
  for update to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator')
  with check (app.circle_role(circle_id) = 'coordinator');

-- invites: a coordinator of the circle may create them.
create policy ins_invites on public.invites
  for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');

-- circles / organizations: no INSERT, UPDATE(circles), or DELETE policy for
-- app_authenticated. Onboarding and deletion run on the admin pool.
-- organizations UPDATE stays owner-only for future settings screens.
create policy upd_organizations on public.organizations
  for update to app_authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

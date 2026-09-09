-- shifts: coordinator does everything; an assigned caregiver may UPDATE
-- (trigger 013 limits them to checked_in_at / checked_out_at).
create policy ins_shifts on public.shifts for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');
create policy upd_shifts on public.shifts for update to app_authenticated
  using (
    app.circle_role(circle_id) = 'coordinator'
    or caregiver_id = (select auth.uid())
  )
  with check (
    app.circle_role(circle_id) = 'coordinator'
    or caregiver_id = (select auth.uid())
  );
create policy del_shifts on public.shifts for delete to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator');

-- routine_items: coordinator only.
create policy ins_routine on public.routine_items for insert to app_authenticated
  with check (app.circle_role(circle_id) = 'coordinator');
create policy upd_routine on public.routine_items for update to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator')
  with check (app.circle_role(circle_id) = 'coordinator');
create policy del_routine on public.routine_items for delete to app_authenticated
  using (app.circle_role(circle_id) = 'coordinator');

-- completions: coordinator or caregiver.
create policy ins_completions on public.completions for insert to app_authenticated
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy upd_completions on public.completions for update to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'))
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy del_completions on public.completions for delete to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'));

-- adhoc_tasks: coordinator or caregiver may add/complete; delete is
-- coordinator OR the person who added it.
create policy ins_adhoc on public.adhoc_tasks for insert to app_authenticated
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy upd_adhoc on public.adhoc_tasks for update to app_authenticated
  using (app.circle_role(circle_id) in ('coordinator','caregiver'))
  with check (app.circle_role(circle_id) in ('coordinator','caregiver'));
create policy del_adhoc on public.adhoc_tasks for delete to app_authenticated
  using (
    app.circle_role(circle_id) = 'coordinator'
    or added_by = (select auth.uid())
  );

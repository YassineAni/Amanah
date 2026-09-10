-- ONE policy. membership AND tier, in a single USING expression, so there
-- is nothing to OR past. A viewer without "full" gets zero rows. (C1, C6)
-- Columns visibility / recorded_by / is_proxy are the frozen denormalized
-- copies on this table (migration 013) — the policy never touches checkins.
create policy sel_checkin_content on public.checkin_content
  for select to app_authenticated
  using (
    app.is_member(circle_id)
    and (
      recorded_by = (select auth.uid())              -- your own recording, any tier
      or case visibility
           when 'circle' then true
           when 'family' then
             app.circle_role(circle_id) = 'coordinator'
             or app.is_family(circle_id)
           when 'coordinator' then
             app.circle_role(circle_id) = 'coordinator'
           when 'mood_only' then false
         end
    )
  );

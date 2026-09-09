-- INSERT: an elder/coordinator/caregiver of the circle, recording as
-- themselves, with is_proxy consistent with their role.
create policy ins_checkins on public.checkins
  for insert to app_authenticated
  with check (
    app.circle_role(circle_id) in ('elder','coordinator','caregiver')
    and recorded_by = (select auth.uid())
    and is_proxy = (app.circle_role(circle_id) <> 'elder')
  );

-- UPDATE: non-proxy check-ins — only the elder. Proxy check-ins — the
-- elder, the recorder, or a coordinator. (Column scope: trigger 013 limits
-- the change to `visibility`.) The elder may only touch a check-in whose
-- content she can see: recorded by her, or a tier that admits her.
create policy upd_checkins on public.checkins
  for update to app_authenticated
  using (
    case
      when not is_proxy then app.circle_role(circle_id) = 'elder'
      else app.circle_role(circle_id) = 'elder'
           or recorded_by = (select auth.uid())
           or app.circle_role(circle_id) = 'coordinator'
    end
    and (
      recorded_by = (select auth.uid())
      or app.circle_role(circle_id) = 'coordinator'
      or visibility in ('circle','family')
    )
  )
  with check (true);

create policy del_checkins on public.checkins
  for delete to app_authenticated
  using (
    case
      when not is_proxy then app.circle_role(circle_id) = 'elder'
      else app.circle_role(circle_id) = 'elder'
           or recorded_by = (select auth.uid())
           or app.circle_role(circle_id) = 'coordinator'
    end
  );

-- checkin_content mirrors its parent: you may write the content row iff you
-- may write the parent checkins row for the same circle and recorder.
create policy ins_checkin_content on public.checkin_content
  for insert to app_authenticated
  with check (
    app.circle_role(circle_id) in ('elder','coordinator','caregiver')
    and recorded_by = (select auth.uid())
  );

create policy upd_checkin_content on public.checkin_content
  for update to app_authenticated
  using (
    recorded_by = (select auth.uid())
    or app.circle_role(circle_id) = 'coordinator'
    or (app.circle_role(circle_id) = 'elder' and not is_proxy)
  )
  with check (true);

create policy del_checkin_content on public.checkin_content
  for delete to app_authenticated
  using (
    recorded_by = (select auth.uid())
    or app.circle_role(circle_id) = 'coordinator'
    or (app.circle_role(circle_id) = 'elder' and not is_proxy)
  );

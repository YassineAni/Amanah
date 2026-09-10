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
-- content she can see: recorded by her, or a tier that ADMITS her.
--
-- `app.is_member(circle_id) and (...)` is load-bearing: the identity branch
-- (`recorded_by = auth.uid()`) carries no membership predicate of its own, so
-- without the gate a soft-removed member keeps UPDATE/DELETE on rows they
-- recorded. An UPDATE/DELETE with no WHERE and no RETURNING needs no read
-- permission, so the (correctly gated) SELECT policy never backstops it.
create policy upd_checkins on public.checkins
  for update to app_authenticated
  using (
    app.is_member(circle_id) and (
      case
        when not is_proxy then app.circle_role(circle_id) = 'elder'
        else app.circle_role(circle_id) = 'elder'
             or recorded_by = (select auth.uid())
             or app.circle_role(circle_id) = 'coordinator'
      end
      and (
        recorded_by = (select auth.uid())
        or app.circle_role(circle_id) = 'coordinator'
        -- test ADMISSION to the current tier, not the tier's name: `family`
        -- admits only a coordinator or an is_family_member. (spec §5)
        or (visibility = 'circle'
            or (visibility = 'family' and app.is_family(circle_id)))
      )
    )
  )
  with check (true);

create policy del_checkins on public.checkins
  for delete to app_authenticated
  using (
    app.is_member(circle_id) and (
      case
        when not is_proxy then app.circle_role(circle_id) = 'elder'
        else app.circle_role(circle_id) = 'elder'
             or recorded_by = (select auth.uid())
             or app.circle_role(circle_id) = 'coordinator'
      end
    )
  );

-- checkin_content mirrors its parent: you may write the content row iff you
-- may write the parent checkins row for the same circle and recorder.
create policy ins_checkin_content on public.checkin_content
  for insert to app_authenticated
  with check (
    app.circle_role(circle_id) in ('elder','coordinator','caregiver')
    and recorded_by = (select auth.uid())
  );

-- Same membership gate as upd_checkins / del_checkins above: the
-- `recorded_by = auth.uid()` branch must not survive a soft removal.
create policy upd_checkin_content on public.checkin_content
  for update to app_authenticated
  using (
    app.is_member(circle_id) and (
      recorded_by = (select auth.uid())
      or app.circle_role(circle_id) = 'coordinator'
      or (app.circle_role(circle_id) = 'elder' and not is_proxy)
    )
  )
  with check (true);

create policy del_checkin_content on public.checkin_content
  for delete to app_authenticated
  using (
    app.is_member(circle_id) and (
      recorded_by = (select auth.uid())
      or app.circle_role(circle_id) = 'coordinator'
      or (app.circle_role(circle_id) = 'elder' and not is_proxy)
    )
  );

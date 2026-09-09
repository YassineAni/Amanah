-- Populate profiles on signup. SECURITY DEFINER + owned by postgres so it
-- writes past profiles' RLS. full_name can never be null and is bounded,
-- so a magic-link signup carrying no metadata cannot 500. (spec §4, S8)
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        split_part(new.email, '@', 1)
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Generic updated_at bump.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_profiles       before update on public.profiles       for each row execute function app.set_updated_at();
create trigger touch_organizations  before update on public.organizations  for each row execute function app.set_updated_at();
create trigger touch_circles        before update on public.circles        for each row execute function app.set_updated_at();
create trigger touch_circle_members before update on public.circle_members for each row execute function app.set_updated_at();

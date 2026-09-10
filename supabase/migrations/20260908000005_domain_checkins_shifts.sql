create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references public.circles (id) on delete cascade,
  occurred_on date not null,
  mood        mood not null,
  spoken_lang text not null,
  visibility  checkin_visibility not null default 'family',
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  is_proxy    boolean not null default false,
  created_via text not null default 'live' check (created_via in ('live', 'demo')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index checkins_circle_day_idx on public.checkins (circle_id, occurred_on desc);

-- Words + audio. Its own RLS tier policy (migration 009). The four
-- denormalized columns are copied from the parent row by a trigger
-- (migration 013) and frozen, so the tier policy is self-contained and
-- never subqueries checkins. (spec §4, D12)
create table public.checkin_content (
  checkin_id  uuid primary key references public.checkins (id) on delete cascade,
  circle_id   uuid not null references public.circles (id) on delete cascade,
  visibility  checkin_visibility not null,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  is_proxy    boolean not null,
  transcript  text not null default '',
  translation text not null default '',
  audio_path  text check (audio_path is null or audio_path like circle_id::text || '/%'),
  created_at  timestamptz not null default now()
);
create index checkin_content_circle_idx on public.checkin_content (circle_id);

create table public.shifts (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  caregiver_id     uuid references public.profiles (id) on delete set null,
  purpose          text not null default '',
  activity_tags    activity_tag[] not null default '{}',
  coordinator_note text,
  checked_in_at    timestamptz,
  checked_out_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at),
  constraint shifts_checkout_needs_checkin
    check (checked_out_at is null or checked_in_at is not null)
);
create index shifts_circle_start_idx on public.shifts (circle_id, starts_at);
-- upd_shifts' USING filters on caregiver_id per row
create index shifts_caregiver_idx on public.shifts (caregiver_id);

create trigger touch_checkins before update on public.checkins for each row execute function app.set_updated_at();
create trigger touch_shifts   before update on public.shifts   for each row execute function app.set_updated_at();

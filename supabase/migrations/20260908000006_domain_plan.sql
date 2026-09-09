create table public.routine_items (
  id             uuid not null default gen_random_uuid(),
  circle_id      uuid not null references public.circles (id) on delete cascade,
  title          text not null,
  time_of_day    time not null,
  category       task_category not null default 'other',
  time_sensitive boolean not null default false,
  weekdays       smallint[] not null,
  effective_from date not null default current_date,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (id),
  constraint routine_items_weekdays_valid check (
    weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    and array_length(weekdays, 1) between 1 and 7
  ),
  -- lets completions compose-FK on (routine_item_id, circle_id)
  constraint routine_items_id_circle_uq unique (id, circle_id)
);
create index routine_items_circle_idx on public.routine_items (circle_id);

create table public.completions (
  id              uuid primary key default gen_random_uuid(),
  circle_id       uuid not null references public.circles (id) on delete cascade,
  routine_item_id uuid not null,
  on_date         date not null,
  done_at         timestamptz not null default now(),
  done_by         uuid not null references public.profiles (id) on delete restrict,
  note            text,
  created_at      timestamptz not null default now(),
  -- the routine item MUST belong to this completion's circle
  constraint completions_item_same_circle
    foreign key (routine_item_id, circle_id)
    references public.routine_items (id, circle_id) on delete cascade,
  constraint completions_one_per_item_day unique (routine_item_id, on_date)
);
create index completions_circle_day_idx on public.completions (circle_id, on_date);

create table public.adhoc_tasks (
  id             uuid primary key default gen_random_uuid(),
  circle_id      uuid not null references public.circles (id) on delete cascade,
  on_date        date not null,
  title          text not null,
  time_of_day    time not null,
  category       task_category not null default 'other',
  time_sensitive boolean not null default false,
  added_by       uuid not null references public.profiles (id) on delete restrict,
  done_at        timestamptz,
  done_by        uuid references public.profiles (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index adhoc_tasks_circle_day_idx on public.adhoc_tasks (circle_id, on_date);

create trigger touch_routine_items before update on public.routine_items for each row execute function app.set_updated_at();
create trigger touch_adhoc_tasks   before update on public.adhoc_tasks   for each row execute function app.set_updated_at();

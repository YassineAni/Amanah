-- profiles: app mirror of auth.users, populated by a trigger (migration 004)
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  citext not null,
  full_name              text not null,
  ui_lang                text not null default 'en' check (ui_lang in ('en', 'fr')),
  tos_accepted_at        timestamptz,
  privacy_notice_version text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          org_kind not null default 'family',
  owner_user_id uuid not null references public.profiles (id) on delete restrict,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index organizations_owner_idx on public.organizations (owner_user_id);

create table public.circles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  elder_user_id uuid references public.profiles (id) on delete set null,
  elder_name    text not null,
  elder_lang    text not null default 'ar',
  timezone      text not null,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index circles_org_idx on public.circles (org_id);
-- one elder account is the elder of at most one circle
create unique index circles_one_elder_per_user
  on public.circles (elder_user_id) where elder_user_id is not null;

create table public.circle_members (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             circle_role not null,
  is_family_member boolean not null default true,
  invited_by       uuid references public.profiles (id) on delete set null,
  joined_at        timestamptz not null default now(),
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- a person has at most one active membership per circle (soft-removed rows
-- do not count, so a removed member can be re-invited)
create unique index circle_members_one_active
  on public.circle_members (circle_id, user_id) where removed_at is null;
-- at most one active elder per circle
create unique index circle_members_one_elder
  on public.circle_members (circle_id) where role = 'elder' and removed_at is null;
create index circle_members_lookup
  on public.circle_members (user_id, circle_id) where removed_at is null;

create table public.invites (
  id               uuid primary key default gen_random_uuid(),
  circle_id        uuid not null references public.circles (id) on delete cascade,
  email            citext not null,
  role             circle_role not null,
  is_family_member boolean not null default true,
  token            text not null unique,
  invited_by       uuid not null references public.profiles (id) on delete restrict,
  expires_at       timestamptz not null default (now() + interval '14 days'),
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index invites_email_idx on public.invites (email);
-- one email cannot pile up pending invites to the same circle
create unique index invites_one_pending_per_email
  on public.invites (circle_id, email) where accepted_at is null;

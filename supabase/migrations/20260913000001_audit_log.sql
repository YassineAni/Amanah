-- Real (if scoped) answer to a named residual risk in
-- docs/pilot-privacy-assessment.md §6: "no audit log — if something goes
-- wrong, there's no way to reconstruct who saw what, when." Logs who
-- accessed check-in content/audio and who performed destructive/membership
-- actions, so that reconstruction is now possible.
--
-- actor_id and circle_id are deliberately PLAIN uuid columns, not foreign
-- keys. An audit log exists specifically to survive past the thing it's
-- about — a circle being deleted, or (less likely, but possible) an
-- account being removed, must not cascade-delete the record of what
-- happened while it existed. A hard FK here would defeat the table's own
-- purpose.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  circle_id uuid,
  action text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index audit_log_circle_idx on public.audit_log (circle_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);

-- FORCE + zero policies granted to app_authenticated: the same
-- "service/admin only" pattern already used for the audio Storage bucket
-- (migration 20260912000001). No regular request, however it's
-- authenticated, can read or write this table — only adminPool
-- (BYPASSRLS) can, from server code that explicitly writes an audit
-- entry.
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- Explicit REVOKE, not just RLS: 20260908000015_lockdown_grants.sql's
-- `alter default privileges ... grant select, insert, update, delete on
-- tables to app_authenticated` applies to every table created afterward,
-- audit_log included — confirmed via information_schema.role_table_grants.
-- RLS alone already fully blocks app_authenticated today (it's neither
-- the table owner nor BYPASSRLS), so this is a second, independent layer,
-- not a fix for a live hole — but for the one table whose entire purpose
-- is being trustworthy forensic evidence, a future accidental permissive
-- policy shouldn't be the ONLY thing standing between app_authenticated
-- and this table. Costs nothing: adminPool connects as the table
-- owner/BYPASSRLS role and is unaffected by table grants.
revoke all on public.audit_log from app_authenticated;

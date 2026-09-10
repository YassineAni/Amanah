-- Extensions ---------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- Dedicated schema for RLS helper functions ------------------------------
create schema if not exists app;

-- The role the API's request pool logs in as. NOT a Supabase-generated
-- role. No BYPASSRLS. Every RLS policy targets this role by name.
-- The password is only used by the local stack and CI; production sets it
-- out of band and passes it via DATABASE_URL.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_authenticated') then
    create role app_authenticated login password 'app_authenticated' noinherit;
  end if;
end $$;

-- app_authenticated must be able to reach the schemas (row access is still
-- gated by RLS; table-level GRANTs come in migration 015).
grant usage on schema public to app_authenticated;
grant usage on schema app to app_authenticated;

-- Enums -----------------------------------------------------------------
create type org_kind as enum ('family', 'agency');
create type circle_role as enum ('elder', 'coordinator', 'caregiver', 'family');
create type mood as enum ('good', 'ok', 'hard');
create type checkin_visibility as enum ('circle', 'family', 'coordinator', 'mood_only');
create type task_category as enum ('medication', 'personal_care', 'meal', 'rest', 'activity', 'other');
create type activity_tag as enum (
  'companionship', 'mobility', 'outing', 'meal_prep', 'hygiene', 'medical', 'household', 'other'
);

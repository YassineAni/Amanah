-- The browser's anon key and any Supabase user JWT resolve to these roles.
-- PostgREST is already pinned away from `public` in config.toml; this makes
-- the lock explicit and survives a config mistake. (spec §3, D13)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The API pool (app_authenticated) needs row-level DML on every tenant
-- table; RLS still decides which rows.
grant select, insert, update, delete on all tables in schema public to app_authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_authenticated;

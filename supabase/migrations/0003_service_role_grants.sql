-- This project does not auto-grant new tables to Supabase roles, so the server's
-- service_role had no table access. Grant it explicitly (it bypasses RLS by design),
-- and do the same for tables created by future migrations.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

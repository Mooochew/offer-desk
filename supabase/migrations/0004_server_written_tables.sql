-- Phase 1 review fixes (reviews/phase-1.md S1, N4) and Phase 2 review S5 (reviews/phase-2.md).
-- Not yet applied when the Phase 2 review ran, so its fixes are folded in here (one paste).

-- S1: refs, files, result_sets and messages are written only by the server (which sets user_id
-- from a verified session). Users keep read access to their own rows. Without this, a user could
-- insert a `files` row pointing at another user's storage path, fake `refs`, or `system` messages.
revoke insert, update, delete
  on public.refs, public.files, public.result_sets, public.messages
  from authenticated;

drop policy if exists "own rows" on public.refs;
drop policy if exists "own rows" on public.files;
drop policy if exists "own rows" on public.result_sets;
drop policy if exists "own rows" on public.messages;

create policy "read own rows" on public.refs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own rows" on public.files
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own rows" on public.result_sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy "read own rows" on public.messages
  for select to authenticated using (user_id = (select auth.uid()));

-- Storage paths must live under the owner's folder: exports/<user_id>/...
alter table public.files
  add constraint files_storage_path_owned check (storage_path like user_id::text || '/%');

-- N4: counters are time-bucketed, so expired rows are never read again. Delete them as part of
-- each increment so the table stays small without a cron job.
create index counters_expires_at_idx on public.counters (expires_at);

create or replace function public.increment_counter(counter_key text, ttl_seconds integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  new_count integer;
begin
  delete from public.counters where expires_at < now();

  insert into public.counters (key, count, expires_at)
  values (counter_key, 1, now() + make_interval(secs => ttl_seconds))
  on conflict (key) do update set count = public.counters.count + 1
  returning count into new_count;

  return new_count;
end;
$$;

-- `create or replace` keeps existing grants, but restate them so this file is self-contained.
revoke execute on function public.increment_counter(text, integer) from public, anon, authenticated;
grant execute on function public.increment_counter(text, integer) to service_role;

-- Phase 2 review S5: user-writable fields go into every agent prompt (profile) or the UI
-- (notes), so cap their size. Without this, one anonymous visitor could store a huge blob and
-- burn the shared OpenAI key and daily cap for everyone. The server also truncates when it
-- builds the prompt (Phase 4); these limits are the backstop.
alter table public.profiles
  add constraint profiles_name_length check (name is null or length(name) <= 100),
  add constraint profiles_skills_size check (
    coalesce(array_length(skills, 1), 0) <= 50 and length(array_to_string(skills, ',')) <= 1500
  ),
  add constraint profiles_locations_size check (
    coalesce(array_length(locations, 1), 0) <= 10 and length(array_to_string(locations, ',')) <= 500
  ),
  add constraint profiles_filters_size check (pg_column_size(filters) <= 2048);

alter table public.applications
  add constraint applications_notes_length check (length(notes) <= 2000);

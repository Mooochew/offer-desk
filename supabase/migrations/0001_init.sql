-- Offer Desk: initial schema.
-- Run once in Supabase Dashboard -> SQL Editor (or `supabase db push`).
--
-- Two kinds of tables:
--   Shared (postings, extractions, caches, counters): public job data and server bookkeeping.
--     RLS on with NO policies, so only the server's secret key can touch them.
--   User-owned (profiles, applications, ...): RLS limits every row to user_id = auth.uid().
--     action_log is read-only for users; only the server writes audit entries.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared tables (server only)
-- ---------------------------------------------------------------------------

create table public.postings (
  id               uuid primary key default gen_random_uuid(),
  source           text not null check (source in ('greenhouse', 'lever', 'ashby', 'adzuna', 'snapshot')),
  source_id        text not null,
  company          text not null,
  title            text not null,
  location         text,
  remote           text not null default 'unknown' check (remote in ('onsite', 'hybrid', 'remote', 'unknown')),
  url              text not null,
  description      text,
  description_hash text,
  description_truncated boolean not null default false,
  posted_at        timestamptz,
  dedupe_key       text not null,
  raw              jsonb,
  fetched_at       timestamptz not null default now(),
  unique (source, source_id)
);
create index postings_dedupe_key_idx on public.postings (dedupe_key);
create index postings_description_hash_idx on public.postings (description_hash);

-- Extraction cache: one row per (description, prompt version, model), so changing the prompt
-- or model re-extracts instead of serving stale results.
create table public.extractions (
  description_hash text not null,
  prompt_version   text not null,
  model            text not null,
  status           text not null check (status in ('ok', 'failed')),
  confidence       text not null default 'full' check (confidence in ('full', 'truncated')),
  extracted        jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  primary key (description_hash, prompt_version, model)
);

-- Per-board cache of each ATS board's light job list (see DECISIONS 005).
create table public.board_cache (
  key         text primary key,               -- e.g. 'greenhouse:stripe'
  jobs        jsonb not null,
  status      text not null check (status in ('ok', 'error')),
  error       text,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Per-query cache, used for keyword-search sources (Adzuna).
create table public.search_cache (
  key          text primary key,              -- hash of source + query + location + page
  posting_ids  uuid[] not null default '{}',
  status       jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

-- Counters for rate limits and quotas, e.g. 'user:<id>:2026-11-10T03', 'ip:<hash>:...',
-- 'openai:2026-11-10', 'adzuna:2026-11-10'.
create table public.counters (
  key         text primary key,
  count       integer not null default 0,
  expires_at  timestamptz not null
);

-- Atomically adds 1 to a counter and returns the new value.
create or replace function public.increment_counter(counter_key text, ttl_seconds integer)
returns integer
language sql
set search_path = ''
as $$
  insert into public.counters (key, count, expires_at)
  values (counter_key, 1, now() + make_interval(secs => ttl_seconds))
  on conflict (key) do update set count = public.counters.count + 1
  returning count;
$$;

-- ---------------------------------------------------------------------------
-- User-owned tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text,
  skills      text[] not null default '{}',
  grad_date   date,
  locations   text[] not null default '{}',
  remote_ok   boolean not null default true,
  max_years   integer not null default 2 check (max_years between 0 and 20),
  filters     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per search; the agent refers to it by its short ref (S1, S2, ...).
create table public.result_sets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  ref            text not null,
  query          jsonb not null,
  posting_ids    uuid[] not null default '{}',
  source_status  jsonb,
  breakdown      jsonb,
  ranked         jsonb,
  created_at     timestamptz not null default now(),
  unique (user_id, ref)
);

-- Short refs the model sees (J12, A3, F2, S1) mapped to real ids. See DECISIONS / PLAN 4.4.
create table public.refs (
  user_id     uuid not null references auth.users (id) on delete cascade,
  ref         text not null,
  kind        text not null check (kind in ('posting', 'application', 'file', 'result_set')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, ref),
  unique (user_id, kind, target_id)
);

create table public.applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  posting_id    uuid not null references public.postings (id),
  stage         text not null default 'saved'
                check (stage in ('saved', 'applied', 'screen', 'interview', 'offer', 'rejected', 'archived')),
  applied_at    timestamptz,
  next_step_at  timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, posting_id)
);
create index applications_user_stage_idx on public.applications (user_id, stage);

create table public.files (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('csv', 'checklist', 'ics')),
  filename       text not null,
  storage_path   text not null,
  supersedes_id  uuid references public.files (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Final chat text only (the last few turns are sent to the model as context).
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  turn_id     uuid not null,
  role        text not null check (role in ('user', 'assistant', 'system')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index messages_user_created_idx on public.messages (user_id, created_at desc);

-- Audit log: one row per tool call. Users can read their rows; only the server writes.
create table public.action_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  turn_id         uuid not null,
  tool            text not null,
  destructive     boolean not null default false,
  args            jsonb not null default '{}',
  resolved_args   jsonb,
  preview         jsonb,
  status          text not null default 'proposed'
                  check (status in ('proposed', 'invalid', 'awaiting_confirmation', 'confirmed',
                                    'executed', 'failed', 'rejected', 'expired')),
  result_summary  text,
  error           text,
  duration_ms     integer,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index action_log_user_created_idx on public.action_log (user_id, created_at desc);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger applications_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger action_log_updated_at before update on public.action_log
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.postings     enable row level security;
alter table public.extractions  enable row level security;
alter table public.board_cache  enable row level security;
alter table public.search_cache enable row level security;
alter table public.counters     enable row level security;
alter table public.profiles     enable row level security;
alter table public.result_sets  enable row level security;
alter table public.refs         enable row level security;
alter table public.applications enable row level security;
alter table public.files        enable row level security;
alter table public.messages     enable row level security;
alter table public.action_log   enable row level security;

-- Shared tables: no grants and no policies for browser roles.
revoke all on public.postings, public.extractions, public.board_cache,
              public.search_cache, public.counters
  from anon, authenticated;
revoke execute on function public.increment_counter(text, integer) from public, anon, authenticated;

-- User-owned tables: full access to your own rows only. Explicit grants so this works
-- whether or not the project auto-exposes new tables.
revoke all on public.profiles, public.result_sets, public.refs, public.applications,
              public.files, public.messages, public.action_log
  from anon;
grant select, insert, update, delete
  on public.profiles, public.result_sets, public.refs, public.applications,
     public.files, public.messages
  to authenticated;
grant select on public.action_log to authenticated;

create policy "own rows" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.result_sets
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.refs
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.applications
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.files
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.messages
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read own log" on public.action_log
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage: private bucket for generated files. The server uploads with the secret key
-- and hands out short-lived signed URLs, so no storage policies are needed.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

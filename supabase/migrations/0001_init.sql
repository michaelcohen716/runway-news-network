-- RNN broadcast persistence — one request = one job, with its inputs,
-- generated components (storyboard scenes), logs, and final video.
-- Writes happen server-side with the service-role key (bypasses RLS); RLS is
-- enabled with no anon policies so the publishable key can't read/write.

create extension if not exists "pgcrypto";

-- ── jobs: the request + its outputs ────────────────────────────────────────
create table if not exists public.jobs (
  id              uuid primary key,
  source_url      text not null,
  tier            text,
  status          text not null default 'queued',
  progress        int  not null default 0,
  headline        text,
  summary         text,
  article         jsonb,        -- extracted input article (the "input" content)
  storyboard      jsonb,        -- full generated storyboard (components)
  content_seconds numeric,
  video_url       text,         -- public URL of the final MP4 in storage
  video_path      text,         -- storage object path
  error           text,
  error_code      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── scenes: the generated components, one row per storyboard scene ──────────
create table if not exists public.scenes (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs(id) on delete cascade,
  idx            int  not null,
  kind           text,
  prompt         text,
  narration      text,
  chyron         text,
  target_seconds numeric,
  created_at     timestamptz not null default now()
);
create index if not exists scenes_job_id_idx on public.scenes(job_id);

-- ── job_logs: pipeline log lines per request ───────────────────────────────
create table if not exists public.job_logs (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  level      text not null default 'info',
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists job_logs_job_id_idx on public.job_logs(job_id);

-- ── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ── RLS: deny anon; server uses the service-role key which bypasses RLS ─────
alter table public.jobs     enable row level security;
alter table public.scenes   enable row level security;
alter table public.job_logs enable row level security;

-- ── storage bucket for finished segments (public so clips play in-browser) ──
insert into storage.buckets (id, name, public)
values ('segments', 'segments', true)
on conflict (id) do nothing;

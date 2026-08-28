create extension if not exists pgcrypto;

create table if not exists public.ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  raw_payload jsonb not null,
  extracted_schema jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.ingestion_logs enable row level security;

drop policy if exists "deny direct client access to ingestion_logs"
on public.ingestion_logs;

create policy "deny direct client access to ingestion_logs"
on public.ingestion_logs
for all
to anon, authenticated
using (false)
with check (false);

comment on table public.ingestion_logs is
  'Immutable source payload plus extracted legacy analysis. Generated schema SQL is review-only and must never be auto-executed.';

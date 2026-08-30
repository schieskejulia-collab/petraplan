-- PetraPlan command saga persistence draft.
-- DO NOT execute against production before verifying the live Supabase schema.
-- This models long-running command state without pretending to provide distributed ACID transactions.

create table if not exists command_sagas (
  id uuid primary key default gen_random_uuid(),
  record_id uuid null,
  idempotency_key text not null unique,
  command_name text not null,
  command_status text not null check (command_status in (
    'pending','running','completed','failed','compensating','compensated','blocked'
  )),
  correlation_id uuid null,
  trace_id uuid null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists command_saga_steps (
  id uuid primary key default gen_random_uuid(),
  command_saga_id uuid not null references command_sagas(id),
  step_key text not null,
  step_order integer not null,
  step_status text not null check (step_status in (
    'pending','running','completed','failed','compensating','compensated','skipped'
  )),
  compensatable boolean not null default false,
  attempt integer not null default 0,
  operation_log_id uuid null,
  causation_id uuid null,
  span_id uuid null,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  unique (command_saga_id, step_key)
);

create table if not exists command_saga_events (
  id uuid primary key default gen_random_uuid(),
  command_saga_id uuid not null references command_sagas(id),
  command_saga_step_id uuid null references command_saga_steps(id),
  event_type text not null,
  previous_status text null,
  new_status text not null,
  reason text null,
  correlation_id uuid null,
  trace_id uuid null,
  causation_id uuid null,
  span_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists command_saga_events_saga_created_idx
  on command_saga_events(command_saga_id, created_at);

-- Design rules:
-- 1. command_saga_events is append-only history; never overwrite past transitions.
-- 2. idempotency_key identifies one logical command against one exact source state.
-- 3. A failed step never becomes completed without an explicit later transition.
-- 4. Compensation is explicit and observable; it is not an implicit database rollback.
-- 5. A command may only reach completed after all required steps completed/skipped.
-- 6. The source system remains authoritative for actual side effects.
-- 7. Read-after-write verification should be represented as its own step for critical writes.

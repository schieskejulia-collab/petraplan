-- PetraPlan Review Truth hardening
-- Draft migration: review before applying to the live Supabase project.
-- Goal: store explicit proof instead of inferring review completeness.

alter table if exists public.review_sessions
  add column if not exists reviewer_authorized boolean,
  add column if not exists authorization_level text,
  add column if not exists evidence_checked boolean,
  add column if not exists evidence_refs text[],
  add column if not exists criteria_checked boolean,
  add column if not exists runtime_log_id uuid,
  add column if not exists validation_result_id uuid;

alter table if exists public.review_decisions
  add column if not exists reviewer_id uuid,
  add column if not exists reviewer_type text,
  add column if not exists reviewer_authorized boolean,
  add column if not exists authorization_level text,
  add column if not exists evidence_checked boolean,
  add column if not exists evidence_refs text[],
  add column if not exists criteria_checked boolean,
  add column if not exists reason text,
  add column if not exists decided_at timestamptz,
  add column if not exists runtime_log_id uuid,
  add column if not exists validation_result_id uuid;

-- Foreign keys are intentionally NOT added here yet.
-- We first verify the exact live Supabase schema and existing constraints so the
-- migration cannot accidentally bind to the wrong table/column or break data.

-- Target Review Truth shape exposed by the API:
-- reviewer_id
-- reviewer_type
-- reviewer_authorized
-- authorization_level
-- evidence_checked
-- evidence_reference_ids
-- criteria_checked
-- criterion_result_ids
-- decision
-- reason
-- decided_at
-- runtime_log_id (optional)
-- resolution_id (derived from review_records.resolution_record_id)
-- validation_result_id

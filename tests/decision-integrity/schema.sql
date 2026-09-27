-- Isolated PostgreSQL fixture for the columns used by the real migration.
-- This is NOT a substitute for checking the deployed Supabase schema.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.ingestion_logs (id uuid primary key, status text, source_hash text, raw_payload jsonb);
create table public.records (id uuid primary key, ingestion_log_id uuid references public.ingestion_logs);
create table public.bridge_actor_roles (user_id uuid primary key, active boolean, can_review boolean, can_release boolean);
create table public.conflicts (id uuid primary key, record_id uuid references public.records);
create table public.resolution_records (id uuid primary key, conflict_id uuid references public.conflicts);
create table public.validation_results (
 id uuid primary key, conflict_id uuid references public.conflicts, resolution_record_id uuid references public.resolution_records,
 status text, created_at timestamptz default clock_timestamp()
);
create table public.review_records (id uuid primary key, resolution_record_id uuid references public.resolution_records, validation_result_id uuid);
create table public.review_sessions (id uuid primary key, review_record_id uuid references public.review_records, structure_id uuid, validation_result_id uuid, created_at timestamptz default clock_timestamp());
create table public.review_decisions (
 id uuid primary key, review_session_id uuid references public.review_sessions, decision text, final boolean,
 reviewer_authorized boolean, reviewer_id uuid, authorization_level text, evidence_checked boolean,
 criteria_checked boolean, reason text, decided_at timestamptz, validation_result_id uuid, evidence_refs text[],
 created_at timestamptz default clock_timestamp()
);
create table public.review_criteria (id uuid primary key, structure_id uuid, required boolean);
create table public.review_criterion_results (id uuid primary key default gen_random_uuid(), review_session_id uuid references public.review_sessions, criterion_id uuid references public.review_criteria, passed boolean);
create table public.release_certificates (
 id uuid primary key default gen_random_uuid(), record_id uuid references public.records, conflict_id uuid,
 resolution_record_id uuid, validation_result_id uuid references public.validation_results, review_record_id uuid,
 review_decision_id uuid, release_status text, certified_by_type text, certified_by uuid, reason text,
 truth_snapshot jsonb, certificate_hash text, certified_at timestamptz default clock_timestamp()
);
create table public.release_status_history (id uuid primary key default gen_random_uuid(), release_certificate_id uuid references public.release_certificates, previous_status text, new_status text, changed_by uuid, reason text, created_at timestamptz default clock_timestamp());
create table public.release_logs (
 id uuid primary key default gen_random_uuid(),
 release_certificate_id uuid references public.release_certificates,
 event_type text check (event_type in ('gate_checked','certificate_issued','revoked','superseded','error')),
 message text,
 details jsonb
);
create table public.bridge_decision_audit (id uuid primary key default gen_random_uuid(), record_id uuid, actor_user_id uuid, action text, reason text, validation_result_id uuid, review_record_id uuid, review_decision_id uuid, release_certificate_id uuid, previous_release_status text, new_release_status text, details jsonb);

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;

-- PetraPlan context freshness hardening (DRAFT ONLY)
--
-- This file is intentionally not executed automatically. It records the database
-- fields required by the contextFreshness gate. Verify the live Supabase schema
-- before applying any migration.

alter table if exists public.ingestion_logs
  add column if not exists source_version text,
  add column if not exists schema_version text,
  add column if not exists observed_at timestamptz,
  add column if not exists retrieved_at timestamptz,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz;

-- Existing source_reference and source_hash remain the provenance anchors.
-- Do not backfill observed_at, valid_until or schema_version from guesses.
-- Historical rows with missing metadata must remain explicitly freshness=unknown.

comment on column public.ingestion_logs.source_version is
  'Version/revision reported by the source system when one exists.';
comment on column public.ingestion_logs.schema_version is
  'Version of the mapping/contract used to interpret the source payload.';
comment on column public.ingestion_logs.observed_at is
  'Time the represented source state was actually observed at the source.';
comment on column public.ingestion_logs.retrieved_at is
  'Time PetraPlan retrieved the source state.';
comment on column public.ingestion_logs.valid_from is
  'Optional beginning of the business/technical validity window.';
comment on column public.ingestion_logs.valid_until is
  'End of the explicit validity window used by freshness gating.';

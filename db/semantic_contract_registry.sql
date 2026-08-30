-- DRAFT ONLY. Verify the live Supabase schema before applying.
-- Goal: anchor every interpreted legacy payload to one explicit semantic contract version.

create table if not exists semantic_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_key text not null,
  version text not null,
  source_system text not null,
  source_schema_version text not null,
  semantic_schema_version text not null,
  mapping_hash text not null,
  status text not null default 'draft',
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  unique (contract_key, version)
);

-- Do not silently rewrite mappings in place. A changed mapping should create a new
-- semantic_contracts row/version. Historical ingestions must keep their original reference.

-- Proposed reference columns. Apply only after verifying table/column names in the live DB.
alter table if exists ingestion_logs
  add column if not exists semantic_contract_id uuid,
  add column if not exists source_schema_version text;

alter table if exists records
  add column if not exists semantic_contract_id uuid;

-- Foreign keys intentionally omitted from this draft until the live schema and migration
-- order are verified. The production migration should add them once existing rows are audited.

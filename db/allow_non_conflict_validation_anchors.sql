-- PetraPlan Bridge validation anchor hardening
-- Applied to the live Supabase project on 2026-09-21.
--
-- Purpose:
-- A passing Bridge evaluation still needs a stable row to which its
-- validation_result can refer. The conflicts table already contains a boolean
-- `conflict` column, but an older CHECK constraint forced that value to true.
-- This migration removes that contradiction so `conflict=false` can represent
-- a non-conflicting validation anchor while real conflicts remain `true`.
-- Product code must count/display only rows where conflict=true.

alter table public.conflicts
  drop constraint if exists conflicts_conflict_check;

comment on column public.conflicts.conflict is
  'True for an actual conflict; false when the row is only a validation anchor for a traceable Bridge evaluation.';

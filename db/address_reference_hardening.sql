-- PetraPlan Address/Reference protection, verified against the live schema on 2026-09-23.
-- Existing rows are preserved. The Bridge currently writes only impacts links.
-- A technical link never confirms a value or authorizes review/release.

create or replace function public.prevent_address_reference_rewrite()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception '% is append-only; record a new evidenced observation/decision instead', tg_table_name;
end;
$$;

-- Address identity and the evidence of an observed snapshot are append-only.
drop trigger if exists trg_address_registry_append_only on public.address_registry;
create trigger trg_address_registry_append_only before update or delete on public.address_registry
  for each row execute function public.prevent_address_reference_rewrite();
drop trigger if exists trg_address_observations_append_only on public.address_observations;
create trigger trg_address_observations_append_only before update or delete on public.address_observations
  for each row execute function public.prevent_address_reference_rewrite();

-- Parent addresses must belong to the same source. With append-only parents,
-- existing-node cycles cannot subsequently be assembled. Self-parent is banned.
alter table public.address_registry drop constraint if exists address_registry_not_own_parent;
alter table public.address_registry add constraint address_registry_not_own_parent
  check (parent_address_id is null or parent_address_id <> id);
create or replace function public.check_address_parent_source()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.parent_address_id is not null and not exists (
    select 1 from public.address_registry parent
    where parent.id = new.parent_address_id and parent.source_id = new.source_id
  ) then
    raise exception 'Parent address must exist in the same source';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_address_parent_source on public.address_registry;
create trigger trg_address_parent_source before insert on public.address_registry
  for each row execute function public.check_address_parent_source();

-- Only impacts is implemented. Unused link types, especially the ambiguous
-- replaces, must not become authoritative merely because a CHECK allowed them.
alter table public.impact_links drop constraint if exists impact_links_link_type_check;
alter table public.impact_links add constraint impact_links_link_type_check
  check (link_type = 'impacts');
drop trigger if exists trg_impact_links_append_only on public.impact_links;
create trigger trg_impact_links_append_only before update or delete on public.impact_links
  for each row execute function public.prevent_address_reference_rewrite();

-- Candidate state history was already written as an append-only log by the
-- application; enforce its stated property in the database as well.
drop trigger if exists trg_candidate_state_history_append_only on public.candidate_state_history;
create trigger trg_candidate_state_history_append_only before update or delete on public.candidate_state_history
  for each row execute function public.prevent_address_reference_rewrite();

-- Existing audit_row_change() records the inserted rows. It does not grant
-- these links any business truth, and no browser write policy is added.
drop trigger if exists trg_audit_address_registry on public.address_registry;
create trigger trg_audit_address_registry after insert on public.address_registry
  for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_address_observations on public.address_observations;
create trigger trg_audit_address_observations after insert on public.address_observations
  for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_impact_links on public.impact_links;
create trigger trg_audit_impact_links after insert on public.impact_links
  for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_candidate_state_history on public.candidate_state_history;
create trigger trg_audit_candidate_state_history after insert on public.candidate_state_history
  for each row execute function public.audit_row_change();

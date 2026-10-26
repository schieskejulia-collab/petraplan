-- Development migration, not applied to production.
-- Requires the existing records, release_certificates, release_status_history,
-- and audit_row_change() definitions verified read-only on 2026-10-26.
-- Existing history is retained unchanged, including any ambiguous old events.

create or replace function public.bridge_release_history_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise sqlstate 'PT409' using message = 'Release history is append-only; record a new authorized event';
end;
$$;

create or replace function public.bridge_guard_release_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_record_id uuid;
  v_certificate public.release_certificates%rowtype;
  v_latest public.release_status_history%rowtype;
  v_terminal text;
begin
  -- Match the case-first locking order used by the release/Claim RPCs.
  select record_id into v_record_id from public.release_certificates where id = new.release_certificate_id;
  if not found then raise sqlstate 'PT404' using message = 'Release certificate not found'; end if;
  perform 1 from public.records where id = v_record_id for update;
  select * into v_certificate from public.release_certificates where id = new.release_certificate_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Release certificate not found'; end if;

  if new.new_status is null or new.new_status not in ('trusted','blocked','revoked','superseded','exception') then
    raise sqlstate 'PT400' using message = 'A supported release status is required';
  end if;

  -- Any terminal history defeats subsequent reactivation, regardless of timestamps.
  select new_status into v_terminal from public.release_status_history
    where release_certificate_id = new.release_certificate_id
      and new_status in ('revoked','superseded')
    order by case new_status when 'revoked' then 0 else 1 end limit 1;
  if v_terminal is null and v_certificate.release_status in ('revoked','superseded') then
    v_terminal := v_certificate.release_status;
  end if;
  if v_terminal is not null and new.new_status is distinct from v_terminal then
    raise sqlstate 'PT409' using message = 'Terminal release history cannot be reactivated; issue a new certificate on a fresh basis';
  end if;

  select * into v_latest from public.release_status_history
    where release_certificate_id = new.release_certificate_id
    order by created_at desc nulls first limit 1;
  if v_latest.id is not null and (v_latest.created_at is null or exists (
    select 1 from public.release_status_history
    where release_certificate_id = new.release_certificate_id
      and created_at = v_latest.created_at and id <> v_latest.id
  )) then
    -- An explicit safety terminal event can close an ambiguous legacy history.
    if new.new_status not in ('revoked','superseded') then
      raise sqlstate 'PT409' using message = 'Release history authority is ambiguous';
    end if;
    new.previous_status := 'blocked';
  else
    new.previous_status := coalesce(v_latest.new_status,v_certificate.release_status);
  end if;
  -- Timestamp and predecessor are server observations, never client assertions.
  new.created_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.bridge_release_history_append_only() from public, anon, authenticated;
revoke all on function public.bridge_guard_release_history() from public, anon, authenticated;
grant execute on function public.bridge_release_history_append_only() to service_role;
grant execute on function public.bridge_guard_release_history() to service_role;

create trigger release_status_history_append_only
  before update or delete on public.release_status_history
  for each row execute function public.bridge_release_history_append_only();
create trigger release_status_history_no_truncate
  before truncate on public.release_status_history
  for each statement execute function public.bridge_release_history_append_only();
create trigger release_status_history_guard
  before insert on public.release_status_history
  for each row execute function public.bridge_guard_release_history();
-- The event and its canonical audit entry commit or roll back together.
create trigger release_status_history_audit
  after insert on public.release_status_history
  for each row execute function public.audit_row_change();

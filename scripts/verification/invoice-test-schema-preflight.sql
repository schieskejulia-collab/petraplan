-- Read-only catalogue inventory. Run only against the intended nonproduction DB.
-- Presence does not prove definition equivalence or authorization correctness.
select current_database(), current_user, version();

select version, name from supabase_migrations.schema_migrations
order by version;

select tablename, rowsecurity from pg_tables where schemaname='public'
and tablename in ('bridge_actor_roles','ingestion_logs','records','address_registry',
 'claims','claim_evidence_links','validation_results','review_sessions','release_certificates',
 'release_status_history','bridge_invoice_evidence','invoice_exception_requests',
 'invoice_exception_decisions') order by tablename;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer, p.proconfig,
 md5(pg_get_functiondef(p.oid)) as definition_inventory_md5
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('bridge_capture_invoice_case',
 'bridge_commit_review','bridge_release_case','bridge_revoke_case','bridge_current_release',
 'bridge_claims_basis','bridge_claims_after_validation','bridge_check_invoice_exception',
 'bridge_request_invoice_exception','bridge_decide_invoice_exception',
 'bridge_invoice_duplicate_row','bridge_invoice_duplicate_candidates',
 'bridge_invoice_duplicate_review_basis','bridge_decide_invoice_duplicates','bridge_check_invoice_duplicate_release',
 'bridge_capture_invoice_case_without_duplicate_lock','bridge_release_case_without_duplicate_guard') order by p.proname;

select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema='public'
and event_object_table in ('ingestion_logs','address_registry','claims','release_status_history',
 'bridge_invoice_evidence','invoice_exception_requests','invoice_exception_decisions')
order by event_object_table,trigger_name,event_manipulation;

select table_name, grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and table_name in ('bridge_invoice_evidence',
 'invoice_exception_requests','invoice_exception_decisions') order by table_name,grantee,privilege_type;

-- Direct execute rights on the new read RPCs must remain service-role only.
select routine_name,grantee,privilege_type from information_schema.routine_privileges
where specific_schema='public' and routine_name in
 ('bridge_invoice_duplicate_row','bridge_invoice_duplicate_candidates',
 'bridge_invoice_duplicate_review_basis','bridge_decide_invoice_duplicates','bridge_check_invoice_duplicate_release',
 'bridge_capture_invoice_case_without_duplicate_lock','bridge_release_case_without_duplicate_guard')
order by routine_name,grantee;

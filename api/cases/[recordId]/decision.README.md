Authenticated endpoint: GET/POST /api/cases/:recordId/decision

POST actions: approve_review, reject_review, release, revoke.

All actions require a Supabase bearer session. Permissions are resolved server-side from bridge_actor_roles. The endpoint writes review/release audit records through the service-role client; direct authenticated client writes remain denied by RLS.

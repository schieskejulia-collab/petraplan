Authenticated endpoint: GET/POST /api/cases/:recordId/decision

POST actions: confirm_candidate, reject_candidate, approve_review, reject_review, release, revoke.

All actions require a verified Supabase bearer session. Permissions come from bridge_actor_roles.

Candidate decisions use the service-only bridge_decide_candidate RPC: state and history commit together. Release uses bridge_release_case: current validation, review and snapshot are checked again in the database before certificate, history, log and audit commit together. Old certificates are retained with their original basis.

GET exposes release_blockers and disables release_ready for stale review references. Missing RPC migrations return 503; there is no non-atomic fallback.

Deployment order and verification limits: docs/chinch64-decision-integrity.md.

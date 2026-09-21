# Live Bridge authorized decisions

The mobile Bridge is now designed to operate on persisted Truth Chain data instead of demo state.

Decision flow:

1. Read the persisted case, ingestion snapshot, mapped payload, conflicts, validation, review and release state.
2. Authenticate the human reviewer with Supabase Auth.
3. Resolve the reviewer role from `bridge_actor_roles` on the server.
4. Record explicit review criteria and evidence references.
5. Persist the review session and decision.
6. Only expose release when the authoritative validation passes and the current review is complete, approved and authorized.
7. Persist release/revocation through `release_certificates`, `release_status_history`, `release_logs` and `bridge_decision_audit`.
8. Re-read the same persisted case after every action so the mobile view shows the resulting Truth Chain state.

Direct client writes to the Truth Chain tables remain denied by RLS. All mutations happen in the authenticated server-side decision endpoint.

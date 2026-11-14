# Actual source bytes and scoped meaning assessments

Development draft stacked on the atomic review/Claim/revocation change (#57). No merge, production migration or production deployment is part of this work. The original database was only inspected; these tables and functions have not been installed there.

## Result and limits

The bridge previously checked declared evidence metadata without retrieving the named source. The new `trustedSourceReader.ts` fetches an administrator-pinned version through verified HTTPS. `20261026171407_trusted_source_evidence.sql` freezes its exact bytes and independently computes their SHA-256. A separate scoped human assessment records an exact source excerpt, decision, coverage, reasoning and explicit review criteria.

This establishes a reviewable source and attestation chain. It does not prove reviewer competence, automatically interpret business meaning, confirm a Claim, produce a passing technical validation or issue a release. The checker can return `READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION`, always with `validation_allowed:false` and `release_allowed:false`. `/revalidate` continues to deny positive revalidation. An atomic positive validation consuming this ledger is the next integration boundary; it must also recheck current Claim/rule/candidate bindings, authority, source freshness and revocations at commit.

## Trust and retrieval

- An administrator registers an immutable source URL/version, authority reference, expected SHA-256, media type, size and lifetime. No trusted sources or new domain grants are seeded. `service_role` can read the registry but cannot insert/update it or withdraw an entire source root.
- Independently, the server must configure `PETRAPLAN_EVIDENCE_ALLOWED_ORIGINS` as a nonempty JSON array of exact HTTPS origins. Empty or malformed configuration returns 503. Client bodies cannot supply URLs, bytes, digests or verifier identity.
- Retrieval accepts port 443, no URL credentials or IP literals, exclusively public DNS results and a single pinned address. It uses normal TLS certificate/hostname validation, checks the actual socket peer, permits no redirects or compression, and bounds DNS/HTTP time and bytes. It independently hashes the actual response, uses fatal UTF-8 decoding, and requires the registered digest and media type.
- Supported media are UTF-8 plain text, Markdown, JSON and XML, at most 2 MiB. No PDF/binary parser is implemented. A digest proves byte identity relative to the administrative pin, not the truth of the source or its meaning. The application worker and administrative trust configuration remain trusted components.

## API and authority

`GET/POST /api/cases/:recordId/verified-evidence` authenticates the actual Supabase user and requires an active technical reviewer. GET returns immutable metadata or the actual stored UTF-8 text. POST supports `retrieve`, `assess`, `check`, `withdraw_verification` and `withdraw_assessment`. It never offers source registration, source-wide withdrawal or authority self-assignment. Missing migrations fail visibly with 503; incomplete list queries fail instead of presenting a complete-looking history.

Assessments additionally require an existing unrevoked domain grant for the exact user, case, snapshot and target address. They reuse governed rule authorities rather than introducing another role catalogue. Supporting meaning requires a current approved rule, COMPLETE coverage and explicit checks of actual content, meaning, scope, conditions/exceptions, counterexamples and coverage. Byte offsets must match the stored UTF-8 excerpt exactly. These are accountable human attestations, not a rule interpreter or proof of expertise.

All four new tables have RLS enabled; browser roles have no write/RPC access. Invoker functions use an empty search path. Bytes, assessments, root registrations and withdrawals reject UPDATE, DELETE and TRUNCATE. A withdrawn record stays visible. An opposing/insufficient assessment remains blocking until an explicit authorized assessment withdrawal; expiration cannot silently erase counterevidence.

## Safety and concurrency

Negative assessments, withdrawals and domain authority revocations atomically enter the existing release revocation/audit chain. Failure of that chain rolls back the evidence mutation too. No compensating deletion, history rewrite or automatic reactivation is used.

Root advisory locks synchronize source withdrawal and authority revocation without adding UPDATE privilege to source/authority tables. The order is source roots, authority roots, technical role, case. Freshness uses database wall time after waits. Every check recomputes the actual Claim basis and verifies the current snapshot, candidate mapping, rule approval grant, assessment grant, source lifetime, retrieval age and explicit withdrawals. Readiness remains a diagnostic observation and cannot safely authorize a later write without repeating these checks within that write transaction.

## Verification

- Eight reader tests include an actual local HTTPS server with a temporary test CA: certificate/hostname verification, real streamed bytes, digest changes, private/mixed DNS, redirects, compression, truncation/size and malformed UTF-8 boundaries. Production does not accept a request-controlled CA or transport.
- Five endpoint tests cover authenticated provenance, ignored fabricated URL/bytes/verifier, missing configuration/migrations, source text access, case scope and refusal of self-assigned trust.
- Fourteen SQL tests execute the draft against PGlite with observed original schema constraints and existing governed rule/release guards. They include immutable bytes/history, scoped authority, fabricated excerpts, counterevidence, changed Claim basis, rollback on audit failure and an explicit T0/T1 case.
- The T0/T1 fixture explicitly assumes a previous human-confirmed Claim and usable legacy certificate. New independently pinned opposing source text revokes that trust while raw values, mapping and the original certificate remain unchanged. The reader never creates the fixture's prior human confirmation.
- Eight new multi-connection PostgreSQL 17 tests exercise concurrent source/observation withdrawal, authority revocation, assessment and approval grant expiration, source freshness expiration, and opposing evidence against readiness. They run with the eight existing atomic decision races in isolated GitHub CI, using a localhost-only disposable database and no Supabase credentials.

Fixtures reproduce the relevant original columns, defaults, constraints and guards; adjacent tables contain only necessary keys. PGlite and native PostgreSQL tests do not certify full Supabase Auth/PostgREST behavior or a deployed production schema. CI outcomes must be read at the exact draft commit. A separate Vercel project has reported `Account is blocked.`; passing code tests do not make that deployment status green or establish its billing cause.

## Remaining before the unknown dataset

1. Consume the verified ledger in an atomic positive technical validation path with complete immutable evidence basis; keep Claim confirmation, Review and Release independent.
2. Configure real administrative source pins/origins and existing scoped human authority in an isolated matching environment; review actual business documents, including contradictory meanings and incomplete coverage.
3. Verify the complete bridge, freeze the rules, and only then run the previously unseen dataset. Do not adjust the rules to that dataset during the first evaluation.

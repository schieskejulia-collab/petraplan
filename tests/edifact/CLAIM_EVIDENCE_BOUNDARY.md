# StinoDino → PetraPlan claim/evidence boundary (isolated proof)

## Existing PetraPlan contract inspected
`api-server/src/services/claimFromCandidate.ts` exports `buildExplicitClaimDraft`.
It **rejects any candidate whose state is not exactly `confirmed`**.
Even a confirmed candidate produces a claim draft with `status: UNPROVEN`, scoped to one case and snapshot, with separate source-address, snapshot and candidate evidence links.

## Current StinoDino evidence
`tests/edifact/stinodino-bridge-handoff.mjs` produces `candidate_only` observations from synthetic EDIFACT, with source segment indices, unconfirmed meanings and no release authority. The input is not an authenticated source or a persisted immutable snapshot.

## Required separation
- EDIFACT `QTY` raw value and unit token are **source observations**, not confirmed conversions.
- Segment index is a fixture-local locator; it is **not** a persisted PetraPlan `source_address_id`.
- `sourceId` is a caller-supplied label, not proof of source identity.
- Synthetic input is **not** independent evidence for partner semantics or unit conversions.
- No adapter is allowed to set `candidate.state = confirmed` or invent `CandidateConfirmation`.
- No claim draft, persisted evidence link, decision snapshot or release certificate is created by this proof.
- The claim builder's `confirmed` precondition must not be bypassed to achieve integration.

## Next separately reviewable implementation
1. Establish trusted source identity and immutable snapshot with an authenticated ingestion path.
2. Create durable source addresses and case-scoped candidate records.
3. Route candidate through existing human confirmation and independent semantic evidence checks.
4. Only then call the existing claim-draft API; keep resulting claim `UNPROVEN` pending validation.
5. Verify revocation, concurrency, audit and negative cases before any release path.

No main merge, no database migration, no Vercel/Supabase dependency. This document describes a boundary, **not a completed end-to-end integration**.

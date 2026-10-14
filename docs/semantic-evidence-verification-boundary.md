# Semantic evidence verification boundary

Status: architecture and test contract; **no executable external verifier or live validation path**.

## Three independent assertions

1. **Declared provenance**: source reference, digest string, verification record, verifier, authority reference, and times are present and correctly bound to one Claim, rule version, source address, target address, proposition, case and snapshot.
2. **Verified provenance**: a trusted reader has retrieved the exact source bytes from an allowlisted authority-controlled location; the computed content digest matches a stored digest; the verification event is authenticated, timestamped, immutable, and linked to the source version. A self-reported `verification: VERIFIED` value is **not** this proof.
3. **Verified meaning**: a competent, independently authorized reviewer (or separately proven rule interpreter) has evaluated the actual source content, its scope, definitions, exceptions, counterexamples and completeness against the specific proposition. A digest only proves byte identity, never meaning.

## Current implementation

- `checkTransitionEvidence` checks a supplied lifecycle representation.
- `checkRuleFreshness` checks supplied rule, Claim basis, decision and authority metadata.
- `checkSemanticEvidence` checks supplied evidence identifiers, bindings, coverage, conflicts and declared provenance fields.
- `assessSemanticRevalidation` composes these read-only checks.
- These functions **do not independently fetch, authenticate, hash, or interpret a source**. In particular, `READY_FOR_INDEPENDENT_REVIEW` and `READY_FOR_EXTERNAL_SEMANTIC_VERIFICATION` must never be treated as authorization.
- `/api/cases/:recordId/revalidate` remains fail-closed and performs no positive revalidation or write.

## Required independent verification contract (not implemented)

- An explicit trust configuration identifying approved source systems, resolvers and allowed source-reference forms; no arbitrary URL fetch or client-provided authority.
- Server-controlled source retrieval with immutable source version, bytes and content type; verify a canonical SHA-256 digest computed from the retrieved bytes, not merely the presence of a digest string.
- A persisted verification record bound to the exact source, digest, snapshot, Claim, rule version, target proposition, verifier identity, delegated domain authority, timestamp and evidence basis. Its identity and history must be tamper-evident.
- Separate source-authenticity and semantic-meaning decisions. Record source excerpts/locations or structured evidence anchors, scoped rule conditions, counterexamples, unknown coverage and competing interpretations.
- Validate revocations, changed snapshots, rule/Claim basis, evidence freshness and current authority when evidence is consumed. Never assume a historical `VERIFIED` label remains current.
- For any future positive validation, perform an atomic transaction that rechecks all relevant version and revocation predicates, writes the immutable validation basis, and leaves Review and Release as separate gates.

## Mandatory negative tests before enabling a positive path

- Fabricated source reference, digest or verifier; unreachable source; altered bytes after verification; stale snapshot.
- Correct bytes with irrelevant or contradictory meaning; conflicting authority; scope mismatch; revoked or expired grant.
- Partial/unknown source coverage, missing counterexamples, multiple competing meanings, duplicated evidence IDs.
- Race: evidence or authority revoked between read and validation write; concurrent Claim/rule changes.
- A-10266: `ShippedDate` alone must **never** imply `STATUS=GESCHLOSSEN`.

## Deployment boundary

Do not remove the fail-closed endpoint behavior, merge this PR, run production migrations, or enable automatic validation/release on the strength of declared provenance metadata. First design and verify a trusted source resolver and an independent semantic-review record against a matching nonproduction database.

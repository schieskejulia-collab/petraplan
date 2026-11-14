# Semantic evidence verification boundary

Status: the development draft now includes an executable HTTPS byte reader and persisted scoped human assessments. **No positive validation path is enabled.** See [the implementation and verification report](verification/2026-10-26-trusted-evidence.md).

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
- A separate `/api/cases/:recordId/verified-evidence` endpoint retrieves administrator-pinned source versions, exposes their literal UTF-8 bytes for human inspection, records scoped assessments and explicit withdrawals, and checks their current basis. Its strongest result is `READY_FOR_INDEPENDENT_TECHNICAL_VALIDATION`; both `validation_allowed` and `release_allowed` remain false.
- The server reader independently resolves, fetches and hashes actual bytes with verified TLS. The database independently checks the digest and freezes the bytes, binding, authenticated API actor and server time. This trusts the application worker, database administrator, configured trust root and authorized human assessor; it does not cryptographically prove that a human understood a document.

## Independent verification contract

- An explicit trust configuration identifying approved source systems, resolvers and allowed source-reference forms; no arbitrary URL fetch or client-provided authority.
- Server-controlled source retrieval with immutable source version, bytes and content type; verify a canonical SHA-256 digest computed from the retrieved bytes, not merely the presence of a digest string.
- A persisted verification record bound to the exact source, digest, snapshot, Claim, rule version, target proposition, verifier identity, delegated domain authority, timestamp and evidence basis. Its identity and history must be tamper-evident.
- Separate source-authenticity and semantic-meaning decisions. Record source excerpts/locations or structured evidence anchors, scoped rule conditions, counterexamples, unknown coverage and competing interpretations.
- Validate revocations, changed snapshots, rule/Claim basis, evidence freshness and current authority when evidence is consumed. Never assume a historical `VERIFIED` label remains current.
- **Still outstanding:** for any future positive validation, perform an atomic transaction that rechecks all relevant version and revocation predicates, writes the immutable validation basis, and leaves Review and Release as separate gates. The new evidence ledger does not connect a positive result to `/revalidate` or promote an UNPROVEN Claim.
- **Still outstanding:** configure actual business trust roots and independently appointed domain reviewers, exercise the adapter against those documents on a matching nonproduction database, and add a separately verified parser before accepting PDFs or other binary formats. The current reader accepts only bounded UTF-8 text, Markdown, JSON and XML.

## Mandatory negative tests before enabling a positive path

- Fabricated source reference, digest or verifier; unreachable source; altered bytes after verification; stale snapshot.
- Correct bytes with irrelevant or contradictory meaning; conflicting authority; scope mismatch; revoked or expired grant.
- Partial/unknown source coverage, missing counterexamples, multiple competing meanings, duplicated evidence IDs.
- Race: evidence or authority revoked between read and validation write; concurrent Claim/rule changes.
- A-10266: `ShippedDate` alone must **never** imply `STATUS=GESCHLOSSEN`.

## Deployment boundary

Do not remove the fail-closed endpoint behavior, merge these drafts, run production migrations, or enable automatic validation/release on the strength of declared provenance metadata. The isolated fixtures verify the resolver and assessment contract; they do not establish real business authority or certify an installed Supabase deployment.

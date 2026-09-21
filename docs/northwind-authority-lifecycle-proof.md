# Northwind Authority Lifecycle Proof

This proof extends the pinned 830-order Northwind run with one deliberately scoped, test-only semantic authority rule.

## What is being tested

The rule does **not** claim universal Northwind business truth. It exists only to prove the lifecycle:

`UNPROVEN -> authority-backed CONFIRMED -> contract re-evaluation -> RELEASED -> evidence REVOKED -> affected releases identified and re-opened`

The test-only evidence says:

- source fact: `order.ShippedDate` is not null
- governed Bridge meaning: canonical `STATUS = closed`
- scope: `northwind-proof-only`
- authority: `northwind-proof-authority`
- version: `1.0.0`

## Safety boundaries

- The original Northwind envelope is never mutated.
- The observed Bridge raw record is never rewritten.
- Only STATUS-related failures may be resolved by this evidence.
- Ambiguous multi-detail `MENGE` remains blocking.
- Revoking the evidence removes every release that depended on it.
- Release basis stores the exact evidence ID, version, review and authority.

The point of the proof is dependency traceability, not to assert that `ShippedDate` should mean `closed` in a real Northwind integration.

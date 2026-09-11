# PetraPlan architecture hardening

This roadmap hardens the current Truth Chain prototype as a **read-only analysis and translation bridge**. PetraPlan is not a write-back or migration engine: the source remains unchanged.

Related internal model: [`reference-model-dialect-mapping.md`](./reference-model-dialect-mapping.md).

## Implemented / represented today

- Preserved source and ingestion evidence
- Semantic mapping kept separate from raw source
- Conflict, execution, runtime, resolution and validation traces
- Review Truth with explicit reviewer/evidence/criteria requirements
- Release gate with certificate-anchored authoritative validation
- Freshness/provenance gate logic
- Versioned provenance for bridge, contract, mapping, validation and source snapshot
- Explicit type-conversion safety before canonical mapping
- Canonical values remain unresolved when conversion or meaning is not confirmed
- Source policy `preserve`
- Write policy `forbidden`
- Mapping / conversion layers have no release authority

## Hardening direction

### 1. Reference model vs. concrete instance

Use known standards or reference models only to narrow the search space.

A concrete source must still confirm its own structure through available metadata, configuration, documentation or other suitable evidence.

Reference knowledge may create a hypothesis. It must never silently become an instance-level fact.

### 2. Schema / contract registry

Version mappings and semantic contracts explicitly. Every interpreted payload must point to the exact contract and mapping versions used.

No silent drift from a legacy source schema to a new semantic meaning.

### 3. Relationship and identity context

Do not reduce a system to isolated fields.

Where the source exposes relationships, distinguish explicitly between:

- identity
- technical relation
- cardinality
- observed linkage
- confirmed business meaning

A technical foreign-key-like relation is not automatically a business rule.

### 4. Observability / trace context

Keep enough context to explain an evaluation later:

- source snapshot identity
- observed / retrieved time
- source and schema version where available
- mapping and validation versions
- evidence references
- evaluation result

The goal is reproducibility and explanation, not write orchestration.

### 5. Read model / cache strategy

Do not route high-volume reads directly to a fragile legacy source without understanding the source capability and load profile.

Introduce a read model only when a real source connection and measured need exist. Its records must carry provenance and staleness metadata.

A cache or read model must never become Source Truth by convenience.

### 6. Runtime context as evidence

Session, freshness, version and conflict state may change what was actually observable at a given moment.

Record those states when available, but do not confuse a runtime representation with the preserved source itself.

### 7. Read-only adapter discipline

Concrete adapters may differ by database, API, file format or legacy technology, but the Bridge contract stays conservative:

- capabilities are declared and checked
- unsupported / unknown is a valid state
- reads are explicit
- source mutation is forbidden
- technical capability does not grant semantic or release authority

## Non-goals for the current bridge

- No production writes to legacy/source systems.
- No automatic source correction or write-back.
- No distributed transactions, Saga orchestration or compensating writes.
- No commit/rollback workflow as part of the Bridge product.
- No cache treated as Source Truth.
- No automatically inferred business semantics without confirmation.
- No knowledge graph merely because one could exist; use relationship modelling only when the source and use case justify it.
- No LLM authority to mutate source data or override release constraints.

## Core rule

**Read before changing. Prove before interpreting. Confirm before using a translation. Preserve the source.**

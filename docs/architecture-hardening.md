# PetraPlan architecture hardening

This roadmap hardens the current Truth Chain prototype as a **read-only analysis and translation bridge**. PetraPlan is not a write-back or migration engine: the source remains unchanged.

Related internal models:

- [`reference-model-dialect-mapping.md`](./reference-model-dialect-mapping.md)
- [`hibernate-derived-architecture.md`](./hibernate-derived-architecture.md)

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

### 3. Confirmed instance profile

Do not stop at field names. The observed instance may need to preserve:

- source / schema / catalog
- entity / table
- source data types
- nullable / required state
- primary and composite keys
- foreign keys
- relation metadata
- collection / storage shape
- subtype / discriminator metadata
- technical defaults
- evidence references
- observed time / snapshot identity

The instance profile describes structure. It does not automatically establish business semantics.

### 4. Identity hardening

Identity is a separate concern from field conversion.

A source object may use a simple key, a natural key, a synthetic key or a composite key. PetraPlan must preserve source identity and distinguish:

- candidate match
- confirmed `same_entity`
- source identity
- canonical identity
- composite-key completeness

A partial key match must not silently become entity equivalence.

### 5. Relationship hardening

Do not reduce a system to isolated fields.

Where the source exposes relationships, distinguish explicitly between:

- identity
- technical relation
- direction
- cardinality
- observed linkage
- owner / inverse side
- foreign key
- join table
- association entity
- confirmed business meaning

A technical foreign-key-like relation is not automatically a business rule.

A join structure may also carry business meaning of its own. Do not collapse it automatically into invisible plumbing.

### 6. Inheritance / subtype hardening

A common conceptual type may have multiple concrete technical forms.

Track where available:

- base type
- concrete subtype
- inheritance strategy
- discriminator field / value
- shared fields
- subtype-specific fields
- table-per-type information

A discriminator can support subtype recognition but must not bypass evidence requirements.

### 7. Collection / ordering semantics

Lists, sets, maps, bags, arrays, indexed collections and join tables may represent the same business relation differently.

Keep storage mechanics separate from business meaning.

Ordering may be technical rather than semantic. Only treat order as a business rule when evidence confirms it.

### 8. Observability / trace context

Keep enough context to explain an evaluation later:

- source snapshot identity
- observed / retrieved time
- source and schema version where available
- mapping and validation versions
- evidence references
- evaluation result

The goal is reproducibility and explanation, not write orchestration.

### 9. Read model / cache strategy

Do not route high-volume reads directly to a fragile legacy source without understanding the source capability and load profile.

Introduce a read model only when a real source connection and measured need exist. Its records must carry provenance and staleness metadata.

A cache or read model must never become Source Truth by convenience.

### 10. Runtime context as evidence

Session, freshness, version and conflict state may change what was actually observable at a given moment.

Record those states when available, but do not confuse a runtime representation with the preserved source itself.

Transaction and cascade behavior may be useful to explain upstream state transitions, but they remain context only.

### 11. Read-only adapter discipline

Concrete adapters may differ by database, API, file format or legacy technology, but the Bridge contract stays conservative:

- capabilities are declared and checked
- unsupported / unknown is a valid state
- reads are explicit
- source mutation is forbidden
- technical capability does not grant semantic or release authority

### 12. Release authority remains separate

Access, mapping and validation must remain separate from decision authority.

- Source adapters can read.
- Mapping can translate confirmed structures.
- Validation can produce findings.
- Only release logic may derive VALID / NEEDS_CONFIRMATION / BLOCKED.

No lower layer may silently upgrade an uncertain result to VALID.

## Non-goals for the current bridge

- No production writes to legacy/source systems.
- No automatic source correction or write-back.
- No automatic source-ID generation.
- No automatic persistence / merge back into source systems.
- No cascade mutations.
- No distributed transactions, Saga orchestration or compensating writes.
- No commit/rollback workflow as part of the Bridge product.
- No source-schema creation or mutation.
- No cache treated as Source Truth.
- No automatically inferred business semantics without confirmation.
- No relationship meaning inferred solely from a join or foreign key.
- No subtype meaning inferred solely from naming convention.
- No knowledge graph merely because one could exist; use relationship modelling only when the source and use case justify it.
- No LLM authority to mutate source data or override release constraints.

## Core rule

**Read before changing. Prove before interpreting. Confirm before using a translation. Preserve the source.**

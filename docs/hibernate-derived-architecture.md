# PetraPlan – Hibernate-derived architecture notes

This document captures the architecture lessons extracted from the Hibernate study block and translates them into PetraPlan's **read-only analysis and translation bridge**.

It is an internal design document. It does **not** create a new public method or add public phases. The Entknotungs-Check remains exactly:

1. Eingang
2. Übersetzung
3. Prüfung
4. Entscheidung

## Product boundary

PetraPlan reads, classifies, translates, validates, decides and documents. It does not write back to the source.

Core safety rule:

**Read before changing. Prove before interpreting. Confirm before using a translation. Preserve the source.**

## Main conclusion from the Hibernate study

A robust bridge must not treat mapping as simple field renaming.

A real instance can only be understood safely when the bridge keeps these concerns separate:

- technical access
- concrete source structure
- identity
- relationships
- inheritance / concrete subtype
- mapping
- semantic confirmation
- canonical representation
- validation and release authority

A concise internal rule is:

**Values are not enough. Identity, relation and context must also be correct.**

## Internal reasoning chain

The reference model narrows the search space but does not prove the instance.

The preferred internal reasoning path is:

**Reference model → observed instance → delta → confirmed instance profile → confirmed mapping → canonical model → validation → decision**

The first stages may generate hypotheses. Only source-backed evidence may confirm instance truth.

## 1. Source adapter profile

A source adapter describes how a source can be read. It must not contain business meaning or release authority.

Recommended fields / concepts:

- `source_id`
- `source_type`
- `access_mode`
- `driver_or_provider`
- `dialect_or_technical_variant`
- `declared_capabilities`
- `read_only`
- `runtime_context`
- `retrieved_at`
- `source_snapshot_id`

Rules:

- Reads are explicit.
- Unknown / unsupported is a valid state.
- A technical capability never grants semantic authority.
- The adapter must not mutate the source.

## 2. Confirmed instance profile

The instance profile describes the concrete structure actually observed in the source.

Recommended fields / concepts:

- source / schema / catalog
- entity / table
- fields / columns
- source data types
- nullable / required state
- technical defaults
- primary keys
- composite keys
- foreign keys
- relationship metadata
- inheritance metadata
- collection / storage shape
- source metadata version where available
- evidence references
- snapshot / observation timestamp

Important distinction:

**Structure is not semantic meaning.**

A field, join, discriminator or foreign key may be detected structurally without its business meaning being confirmed.

## 3. Identity profile

Identity must be modelled explicitly. A bridge must not assume that every object has one simple numeric id.

Identity may be represented by:

- one natural key
- one synthetic key
- a UUID-like technical key
- a sequence / identity generated key
- a composite key containing multiple fields
- an association-derived identity

Recommended concepts:

- `identity_kind`
- `key_fields`
- `composite`
- `source_identity_value`
- `identity_evidence`
- `canonical_identity_status`

Safety rule:

**A candidate match is not the same as confirmed same-entity.**

A safe flow is:

**candidate match → verify all required key parts → confirm `same_entity` → allow relationship / mapping use**

PetraPlan must preserve source identity and provenance even when a separate canonical id exists.

## 4. Relation profile

Relationships are first-class source information.

Recommended relation profile:

- `source_entity`
- `target_entity`
- `direction`
- `cardinality`
- `owner_side`
- `inverse_side`
- `foreign_key`
- `join_table`
- `association_entity`
- `recursive`
- `relation_type`
- `collection_shape`
- `ordering`
- `nullable`
- `cascade_behavior`
- `evidence_refs`

### Relationship direction

A relation may be:

- unidirectional
- bidirectional

PetraPlan must not assume a reverse relation exists merely because the forward relation exists.

### Cardinality

Relevant shapes include:

- 1:1
- 1:n
- n:1
- n:m

Cardinality is part of the observed structure and can be important for validation.

### Join tables and association entities

A join structure may be:

- pure technical linkage, or
- a business-relevant association containing its own attributes.

Therefore:

**The relationship itself may carry business meaning.**

PetraPlan must not collapse every join table into a hidden implementation detail.

### Recursive relations

An entity may relate to itself, for example parent/child or tree structures.

PetraPlan must handle recursion conservatively and avoid infinite traversal.

### Owner vs. business authority

The side that technically stores or owns a relation is not automatically the business-leading side.

Technical ownership must remain separate from confirmed business meaning.

## 5. Collection / storage shape

The same business relation can be represented through different technical collection shapes.

Examples include:

- list
- set
- map
- bag
- array
- join table
- indexed collection
- sorted collection

The canonical model must preserve business meaning, not copy storage mechanics blindly.

### Ordering

Ordering may come from:

- a database column / index
- a query order
- an in-memory comparator
- a collection implementation

Therefore:

**Ordering is not a business rule unless its meaning is confirmed.**

## 6. Inheritance / subtype profile

A common conceptual type may have multiple concrete technical forms.

Recommended profile:

- `base_type`
- `subtypes`
- `inheritance_strategy`
- `discriminator_field`
- `discriminator_values`
- `shared_fields`
- `subtype_specific_fields`
- `table_per_type`
- `evidence_refs`

Relevant observed patterns include:

- one table for the whole hierarchy
- joined tables across hierarchy levels
- table per concrete class
- mapped/shared superclass

A discriminator may help identify the concrete subtype, but it remains evidence that must be interpreted in context.

Internal rule:

**Common core → concrete technical variant → confirmed subtype → mapping**

## 7. Mapping layer

Mapping is an explicit, versioned and auditable layer.

It may contain:

- Field Map
- Value Map
- Type / conversion map
- Identity Map
- Relation Map
- Subtype / discriminator map
- provenance
- mapping version
- evidence references

Only confirmed mappings may feed the canonical model.

Defaults, naming conventions or ORM conventions may generate candidates, but they must not silently become instance truth.

## 8. External mapping as a bridge principle

Hibernate shows that mapping can be declared separately from the source representation, for example via annotations or external XML mapping.

The architectural lesson for PetraPlan is:

**The source does not need to be changed in order to describe how it should be read and understood.**

PetraPlan can maintain mapping definitions outside the source system while preserving source evidence.

## 9. Canonical model rules

The canonical model must represent confirmed meaning, not merely normalize technical syntax.

Rules:

- Unknown meaning remains unresolved.
- Unsafe conversions do not enter canonical values.
- Identity provenance remains traceable.
- Relations remain traceable to source evidence.
- Subtype / discriminator interpretation remains evidence-backed.
- Collection shape may change only when business meaning remains preserved.
- Technical defaults never override explicit instance evidence.

## 10. Cache / read-model rules

Caches and read models are performance mechanisms, not truth sources.

If used later, every cached/read-model record must carry:

- provenance
- source snapshot reference
- observed / retrieved time
- staleness / freshness metadata

Core rule:

**Cache != Source Truth.**

## 11. Runtime and transaction knowledge

Sessions, transactions, locking, write cascades and runtime state are useful for understanding how a source application behaves.

For PetraPlan they are **context / evidence**, not write mechanisms.

The bridge must not implement source mutations through:

- save
- update
- delete
- merge
- write cascades
- commit / rollback orchestration
- distributed transactions
- pessimistic locks

Understanding an upstream transaction boundary can still help interpret why a source snapshot looks the way it does.

## 12. Cascade behavior

Cascade configuration can explain why source applications change multiple related objects together.

PetraPlan may record cascade behavior as source context, but must not execute it.

This includes understanding concepts comparable to:

- persist
- merge
- remove
- refresh
- orphan removal

They remain analysis metadata only.

## 13. Access vs. semantic authority

Hibernate / Spring separation reinforces a useful boundary:

**Access != Mapping != Validation != Decision.**

- Source adapters provide access.
- Mapping layers translate confirmed structures.
- Validators test rules and evidence.
- Decision logic determines VALID / NEEDS_CONFIRMATION / BLOCKED.

No lower layer is allowed to silently grant release authority.

## 14. What remains background knowledge

Useful for interpreting source systems, but not a PetraPlan product core requirement:

- connection pooling
- session factories
- first-level / second-level cache internals
- query cache implementation
- ORM fetch / lazy mechanics
- concrete JPA annotations
- concrete Hibernate XML syntax
- Spring transaction infrastructure
- source-system locking implementation
- ORM-specific optimization switches

## 15. Explicit non-goals

PetraPlan does not:

- write to production source systems
- auto-correct source values
- generate source IDs
- persist or merge source objects
- execute cascade mutations
- propagate deletes / updates
- create or alter source schemas automatically
- treat cache as truth
- infer business meaning from structure alone
- apply mappings merely because a naming convention matches
- treat a reference model as proof of a concrete instance
- let an LLM override source evidence or release constraints

## 16. Mapping into the four public phases

### Eingang

- read source
- preserve snapshot
- observe structure
- observe identity
- observe relation metadata
- observe subtype / discriminator evidence
- keep reference-model assumptions separate from instance evidence

### Übersetzung

- confirm relevant meaning
- apply safe field/value/type mapping
- apply confirmed identity / relation / subtype mappings
- build canonical model from confirmed information only

### Prüfung

- validate schema
- validate identity
- validate relation consistency
- validate cardinality where relevant
- validate semantic rules
- detect unresolved or conflicting evidence
- keep uncertain results visible

### Entscheidung

- derive VALID / NEEDS_CONFIRMATION / BLOCKED from evidence-backed validation
- document snapshot, mapping and rule versions
- identify the safe next step
- never mutate the source automatically

## 17. Internal implementation order

A practical implementation sequence is:

1. source adapter profile
2. confirmed instance profile
3. identity profile
4. relation profile
5. inheritance / subtype profile
6. versioned mapping contracts
7. canonical model integration
8. identity / relation validation
9. trace / report extension

This order is intentionally conservative. It strengthens understanding before adding automation.

## Final internal principle

**The bridge does not replace the source. It describes what the source contains, how its parts are identified and related, which concrete variant is present, and which translations are confirmed safe to use.**

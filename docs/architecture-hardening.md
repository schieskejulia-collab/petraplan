# PetraPlan architecture hardening

This roadmap turns the current Truth Chain prototype into a safer integration architecture without pretending that every production concern is already solved.

## Implemented / represented today

- Preserved source and ingestion evidence
- Semantic mapping kept separate from raw source
- Conflict, execution, runtime, resolution and validation traces
- Review Truth with explicit reviewer/evidence/criteria requirements
- Release gate with certificate-anchored authoritative validation
- Release/review status histories and logs
- Freshness/provenance gate logic (contextFreshness.ts)
- Deterministic idempotency-key generation for retry-safe command design

## Next hardening slices

### 1. Persist freshness metadata
Verify the live Supabase schema before applying `db/context_freshness_hardening.sql`.
Required metadata: source version, schema version, observed time, retrieval time and explicit validity window.
Historical rows must remain `unknown` when this evidence does not exist.

### 2. Schema / contract registry
Version mappings and semantic contracts explicitly. Every interpreted payload must point to the exact contract version used.
No silent drift from a legacy source schema to a new semantic meaning.

### 3. Retry / idempotency persistence
Store idempotency keys with command attempts and results. Repeated delivery of the same command must not create a second side effect.

### 4. Observability / trace context
Add correlation ID, causation ID and trace/span references across ingestion, operation, runtime, validation, review and release records.
Later integration with OpenTelemetry is possible, but the internal identity model comes first.

### 5. Read model / cache strategy
Do not route high-volume agent reads directly to a fragile legacy source.
Introduce a read model only when a real source connection and load profile exist. Its records must carry provenance and staleness metadata.
Critical reads may still require source revalidation.

### 6. Command state / Saga
Only required once PetraPlan performs multi-step writes or long-running actions.
Model command states, retries and compensating actions before attempting distributed write orchestration.

### 7. Sentinel policy enforcement
Sentinel must not become an all-knowing monolith. Separate policy decision from policy enforcement where possible.
Minimum gates: authorization, freshness, provenance, validation status, review completeness, release state and command idempotency.

## Non-goals for the current bridge

- Do not invent CDC infrastructure before a real legacy source is connected.
- Do not introduce distributed transactions for a read/analysis-only path.
- Do not add a knowledge graph only because one could exist; use it only if semantic relationships require it.
- Do not let an LLM perform irreversible writes directly.
- Do not treat a cache as Source Truth.

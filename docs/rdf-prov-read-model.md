# PetraPlan RDF / PROV-O Read Model

This is a read-only projection over existing PetraPlan truth and evidence structures. It is intentionally not a second truth chain.

## Purpose

The projection answers two questions without changing existing semantics:

1. **Womit ist etwas nachweisbar verbunden?** → RDF-shaped statements over existing addresses, parent/child structure, candidates and impact links.
2. **Woher kommen Claim und Belege?** → PROV-O-shaped provenance links over existing snapshot, claim and evidence metadata.

## Boundaries

- `address_registry` remains the source for stable logical addresses.
- `conversion_candidates` remains the source for possible interpretations.
- `claims` remains the source for explicit assertions with status and scope.
- `claim_evidence_links` remains the source for Evidence↔Claim relationships.
- `ingestion_logs` / snapshot references remain provenance anchors.
- The read model does **not** create semantic truth from technical relations.
- The read model does **not** confirm claims.
- The read model does **not** mutate Candidate, Validation, Review or Release.

## Vocabulary used in the projection

RDF-like predicates:

- `rdf:type`
- `pp:contains`
- `pp:sourcePath`
- `pp:observedAtAddress`
- `pp:mayImpact`
- `pp:subjectAddress`
- `pp:claimPredicate`
- `pp:claimObject`
- `pp:status`
- `pp:scope`

PROV-O-shaped predicates:

- `prov:wasDerivedFrom`
- `prov:wasAttributedTo`
- `prov:wasGeneratedBy`
- `prov:wasInfluencedBy`
- `prov:generatedAtTime`

## JuliaDeutsch

**RDF:** zeigt die nachweisbaren Verbindungen, ohne ihnen automatisch fachliche Bedeutung zu geben.

**Claim:** sagt, was wir über diese Verbindungen vermuten oder behaupten.

**PROV-O:** zeigt, woher Claim und Belege kommen. Es sagt nicht, dass der Claim richtig ist.

Der nächste Integrationsschritt nach grünem CI ist, diese Projektion im Case-Trace und in der Live Bridge sichtbar zu machen — zuerst read-only, bevor irgendeine Rule- oder SHACL-Logik ergänzt wird.

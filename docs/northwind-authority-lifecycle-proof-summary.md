Expected proof invariants:

- 830 pinned Northwind orders are evaluated.
- Baseline release count remains 0.
- Only orders with one detail and non-null ShippedDate may become releasable under the scoped test authority rule.
- Multi-detail MENGE ambiguity remains blocking.
- Release basis identifies the exact evidence, version, review, confirmer and authority.
- Revocation of that evidence returns dependent releases to non-released state and identifies the impacted record IDs.

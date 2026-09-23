# External Northwind Mass Proof - 830 Trace Records

This folder preserves a **read-only external test proof** for the PetraPlan Bridge.

It is not a production SAP import, does not alter a source system, and does not grant a release.

## Source and package identity

- Test archive: `external-northwind-mass-proof-v4.zip`
- SHA-256: `ae73b740f7c3cda1ea410b3484dec7bf3121cbf5be604e95f9f7d767f97aabaf`
- Upstream dataset repository: `neo4j-contrib/northwind-neo4j`
- Upstream commit: `5db323116a2779434ba0c17eb2b733575bfc2a4a`
- Upstream files used: `data/orders.csv`, `data/order-details.csv`, `data/customers.csv`

The archive contains the original package summary, a diagnosis, and trace exports in CSV and JSONL format. It is kept unchanged so its hash remains checkable.

## Independent read-only recheck

The JSONL trace export was counted again without importing it into Supabase or changing any Bridge data.

| Check | Result |
| --- | ---: |
| Trace records | 830 |
| Unique record IDs | 830 |
| Source schema accepted | 830 |
| Bridge contract failed | 830 |
| Release allowed | 0 |
| `BLOCKED` | 693 |
| `NEEDS_CONFIRMATION` | 137 |
| Missing customer joins | 0 |
| Confirmed STATUS mappings | 0 |
| Directly mapped single quantities | 137 |

## What this proves

1. The Northwind envelope can be read structurally for all 830 orders.
2. A structurally readable source does not automatically satisfy the confirmed `order-v1` Bridge contract.
3. STATUS remains unresolved because no confirmed semantic status mapping exists.
4. For 693 multiple-detail orders, an order quantity is not invented by silently summing line-item quantities.
5. No record in this proof run is released.

## What this does not prove

1. It does not prove that any Northwind value has the same business meaning as a PetraPlan value.
2. It does not prove a production source system was untouched. The package declares `sourceMutationCount = 0`; independently proving that would require before/after source hashes or source-system logs.
3. It does not authorize a mapping, review, release, export, or execution.

## Concrete example: A-10248

`A-10248` contains three order-detail quantities: `12`, `10`, and `5`.

- STATUS: no confirmed semantic mapping -> unresolved.
- MENGE: no confirmed aggregation rule -> unresolved.
- Bridge state: `BLOCKED`.
- Release allowed: `false`.

This is intentional fail-closed behaviour:

```text
connected != same meaning
confirmed candidate != automatic Bridge mutation
failed validation != review or release
```

## Related research documents

- [01 - Snapshot and 02 - Address](../../research/01-snapshot-02-address.pdf)
- [03 - Reference](../../research/03-reference.pdf)

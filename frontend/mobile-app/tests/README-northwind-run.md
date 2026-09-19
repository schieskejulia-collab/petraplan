# Northwind full bridge run

This test feeds a complete classic Northwind order envelope (customer + order + order details) through a read-only source adapter and then through the existing bridge pipeline.

## What the bridge itself expects today

The current `RawRecord` contract contains five required string fields:

- `KUNDEN_NR`
- `AUFTRAGS_NR`
- `STATUS`
- `MENGE`
- `DATUM`

The Northwind adapter exists in front of that contract. It preserves the original source envelope and only maps fields where there is explicit evidence.

## Confirmed mappings

- `order.CustomerID` -> `KUNDEN_NR`
- `order.OrderID` -> `AUFTRAGS_NR` (prefixed with `A-` to satisfy the current contract)
- one single `orderDetails[0].Quantity` -> `MENGE`
- date part of `order.OrderDate` -> `DATUM`

## Deliberately unmapped

`STATUS` remains empty. Classic Northwind `Order` has no confirmed semantic equivalent for the bridge value map `OFFEN / GESCHLOSSEN / IN_BEARBEITUNG`. The adapter records `NO_CONFIRMED_SEMANTIC_MAPPING` instead of inventing a value.

`MENGE` also remains empty when an order contains more than one `Order_Detail`. Quantities belong to separate product rows; summing them into one Bridge `MENGE` would be an unconfirmed business interpretation. In that case the adapter records `NO_CONFIRMED_SEMANTIC_MAPPING` for `MENGE` as well.

For Northwind order 10248 the expected result is therefore: confirmed customer/order/date mappings, preserved source snapshot, quantity and status blockers, and release denied pending confirmation.

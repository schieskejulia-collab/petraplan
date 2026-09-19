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
- `sum(orderDetails.Quantity)` -> `MENGE`
- date part of `order.OrderDate` -> `DATUM`

## Deliberately unmapped

`STATUS` remains empty. Classic Northwind `Order` has no confirmed semantic equivalent for the bridge value map `OFFEN / GESCHLOSSEN / IN_BEARBEITUNG`. The adapter records `NO_CONFIRMED_SEMANTIC_MAPPING` instead of inventing a value.

The expected result of the full run is therefore: confirmed customer/order/date/quantity mappings, preserved source snapshot, status blocker, and release denied pending confirmation.

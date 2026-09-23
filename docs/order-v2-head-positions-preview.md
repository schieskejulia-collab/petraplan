# order-v2: Kopf und Positionen (Entwurf)

Die Northwind-Detailroute `/api/northwind/:orderId` liefert zusätzlich `orderV2Preview`.
Die Vorschau ist ein read-only Strukturentwurf. `order-v1` bleibt der aktive
Bridge-Vertrag einschließlich seiner bisherigen Validierung und Release-Sperren.

| Ebene | Inhalt | Quellpfad |
| --- | --- | --- |
| Kopf | `orderId`, `customerId`, `orderDate` | `order` |
| Position | `orderId`, `productId`, `quantity`, `unitPrice`, `discount` | `orderDetails[index]` |
| Position-Schlüssel | `orderId` und `productId` | `Order Details` |
| STATUS | `null`, Evidenz `UNPROVEN` | keine bestätigte Northwind-Zuordnung |

Eine Kopf-Menge wird nicht erzeugt. Drei Positionen mit Mengen 12, 10 und 5
bleiben drei Positionen; die Vorschau summiert sie nicht. Fehlende Positionen,
ein falscher Auftragsbezug, doppelte Positionsschlüssel oder nicht positive
ganzzahlige Mengen machen `compatible=false` und erscheinen in `issues`.

`decision=NOT_EVALUATED` bedeutet ausdrücklich, dass diese Strukturvorschau
weder Review noch Freigabe prüft oder erteilt. Ein künftiger aktiver Vertrag
braucht eine separat belegte STATUS-Regel, Positionsvalidierung, eine
versionierte Migration der Verbraucher und einen eigenen Freigabetest. Der
bestehende Test einer STATUS-Autorität mit 133 freigabefähigen Ein-Positionen-
Fällen bleibt auf den bisherigen Proof-Scope begrenzt.

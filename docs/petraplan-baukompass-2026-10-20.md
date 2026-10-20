# PetraPlan – verbindlicher Baukompass (20.10.2026)

## Der eigentliche Bauplan

**LESEN → ÜBERSETZEN → ADRESSIERBAR MACHEN.**

Dies ist die Reihenfolge und der Maßstab für neue Quellen. Claims, Bedeutungsprüfung, Evidenz, Validierung, Review und Release sind **nachgelagerte** Mechanismen; sie ersetzen keinen der drei Grundschritte.

1. **Lesen:** Originalquelle unverändert aufnehmen; Quellformat, Rohdarstellung, Fundstellen, Grenzen und Fehler dokumentieren. Keine stillen Ergänzungen.
2. **Übersetzen:** Technische Repräsentation in ein nachvollziehbares gemeinsames Beobachtungsmodell übertragen. Beobachteter Wert ≠ fachlich bestätigte Bedeutung; Mehrdeutigkeit sichtbar halten.
3. **Adressierbar machen:** Bestandteile eindeutig referenzieren und zur Rohquelle zurückverfolgen. Quellfundstelle, technische Identität und fachliche Identität ausdrücklich unterscheiden. Adressen müssen bei Revisionen und Mehrdeutigkeit geprüft werden.

## Stand: belegt, nicht belegt

- **EDIFACT/StinoDino:** begrenzter read-only ORDERS-D96A-Inspector; LIN/QTY-Beobachtungen, Rohwerte, Qualifier, Einheiten, Segment-Locators, SHA-256-Referenzen und synthetische T0/T1-Vergleiche sind implementiert und getestet. Kein allgemeiner EDIFACT-Validator, kein produktiver Ingress, keine authentifizierte Quelle.
- **Adressgrenze:** `synthetic:stinodino-001#segment-…` bezeichnet eine Quellfundstelle; `synthetic:stinodino-001#LIN-…/QTY` ist nur ein vorgeschlagener Positionsbezug. Gleiche LIN-Nummer allein beweist keine unveränderte Produktidentität; mehrere QTY pro LIN können mehrdeutig sein.
- **PetraPlan-Claims und Gates:** vorhandene Claim-/Beleg-/Freigabeprüfungen einschließlich isolierter PGlite-Tests für fallbezogene Widerrufe. Selektive, unabhängige Positionsfreigaben sind **nicht nachgewiesen**. Kein automatischer Übergang von Rohwert zu fachlicher Autorität.
- **Northwind:** vorhandene Tests und Fallbeispiele; insbesondere `ShippedDate` belegt nicht automatisch `Closed`.
- **Noch nicht belegt:** eine gemeinsame, formatübergreifende Schnittstelle, mit der Northwind und EDIFACT nach denselben Adress- und Rückverfolgungsregeln erschlossen werden.

## Nächster Abnahmeschritt – zuerst, vor weiterer EDIFACT-Sonderlogik

1. Vorhandene Northwind- und EDIFACT-Lese-/Übersetzungs-/Adresspfade nebeneinander inventarisieren.
2. Ein minimales **gemeinsames Beobachtungs-/Adressschema** formulieren, das Rohquelle, Snapshot, Locator, technische Identität, mögliche fachliche Identität, Übersetzung und Unsicherheitsstatus getrennt hält.
3. Mit je einem **synthetischen Northwind- und EDIFACT-Fall** nachweisen: zur Rohquelle rückverfolgbar, eindeutig adressierbar, Änderungen erkennbar, Mehrdeutigkeit fail-closed.
4. Erst danach Integration in Claim-/Evidence-Lifecycle und Prüfung tatsächlicher Abhängigkeiten. Keine Behauptung einer unabhängigen Positionsfreigabe ohne separate Nachweise.

## Arbeitsregeln

**Idee → Test → Beleg → Nachweis.** CI-grün belegt nur die ausgeführten Tests, nicht den gesamten Bauplan. Keine stillen Annahmen oder erfundene Fachsemantik. Human-in-the-loop; erst verstehen, dann automatisieren. Keine Merges, produktiven Deployments, Supabase-Schreibvorgänge oder kostenpflichtigen Aktionen ohne ausdrückliche Freigabe.

Arbeitskontext: GitHub `schieskejulia-collab/petraplan`, Entwurfs-PR #55, Branch `test/stinodino-math-evidence-gates-20261020`. Letzter vor diesem Dokument bestätigter grüner Stand: Commit `7c0f537`, beide CI-Workflows erfolgreich.

**Bei jeder Fortsetzung zuerst diesen Baukompass lesen und gegen den tatsächlichen Repo-Stand prüfen.**

## Codeabgleich: vorhandene Bauteile (20.10.2026)

| Bauabschnitt | Northwind | StinoDino EDIFACT | Gemeinsame Grenze |
| --- | --- | --- | --- |
| Lesen | `bridge-northwind-adapter.ts`, `bridge-source-observation.ts` | `stinodino-entry.mjs` | Verschiedene Quellformate, Rohwerte nicht als bestätigte Bedeutung behandeln |
| Übersetzen | `addressableNorthwind.ts` erzeugt Beobachtungen und **nicht bestätigte** Status-/Mengen-Kandidaten | `stinodino-bridge-handoff.mjs` erzeugt LIN/QTY-Beobachtungen und **nicht bestätigte** Kandidaten | Keine fachliche Bedeutung aus technischem Parsing ableiten |
| Adressieren | `buildAddressLayerProjection` erzeugt Adressen, Elternbezüge, Quellpfade und Kandidaten; `db/address_layer.sql` kennt Registry und Snapshot-Beobachtungen | Segment-Fundstellen und vorgeschlagene LIN/QTY-Adressen; SHA-256-Proof | EDIFACT ist **noch nicht** an dieselbe Address-Layer-Projektion angeschlossen |

**Wichtige Nichtgleichheiten:** Northwind adressiert Mengen derzeit gesammelt als `NW:A-<id>#DetailQuantities` mit `orderDetails[].Quantity`, nicht als nachgewiesene einzelne Positionen. StinoDino verwendet zunächst `#segment-<index>` und schlägt zusätzlich `#LIN-<id>/QTY` vor. Diese Adressarten sind nicht ohne Prüfung austauschbar. Der Northwind-Adapter führt mögliche Summierung und Statusableitung als unbestätigte Kandidaten; sie dürfen nicht als feststehende Übersetzung behandelt werden.

**Technischer nächster Schritt:** eine **read-only, nicht persistierende** EDIFACT-Projektion in der Form von `buildAddressLayerProjection` testen, zunächst nur `addresses` und beobachtete Quellwerte; keine fachlichen Zieladressen, keine bestätigten Konversionen, keine Datenbankmigration. Der gemeinsame Vertrag muss Quellfundstelle und logische Adresse getrennt halten, bei mehrfacher QTY pro LIN und Produktidentitätswechsel Mehrdeutigkeit melden, und eine Rückverfolgung zu den unveränderten Rohdaten ermöglichen. Anschließend Vergleich mit einer einzelnen Northwind-Quellfeldbeobachtung. Bestehende Persistenz- und Freigabepfade bleiben unangetastet.

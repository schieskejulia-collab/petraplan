# Kreisabschluss-Prüfung – 21.10.2026

Status: **TEILWEISE BELEGT; KEINE PRODUKTIONSFREIGABE**.

## Prüfbasis
- Branch: `test/stinodino-math-evidence-gates-20261020`, Commit `5ed9990e37934b3334317ac75afef83e1d43d90f`.
- GitHub Actions: PetraPlan CI Run 39604432227 **success**; StinoDino EDIFACT proof Run 39604432033 **success**.
- EDIFACT-Workflow-Joblog bestätigt den Befehl `node --test tests/edifact/*.test.mjs`. Damit sind die Testdateien im Verzeichnis im Testlauf enthalten; CI-Erfolg allein beweist keine reale Übertragung.

## Kreis 1 – Northwind-Positionsadressen: OFFEN
- `observeNorthwindDetailPositions` liefert pro Position `sourcePath`, `physicalLocator`, `candidateIdentity`, `observedValue` und den Verweis auf `NW:A-10248#DetailQuantities`.
- Die Adresse `#detail-index-i-Quantity` ist positions-/indexgebunden. Beim Umsortieren bleibt sie gleich, kann aber einen anderen Datensatz meinen.
- `buildAddressLayerProjection` enthält diese Einzelpositionen noch **nicht**; keine Registrierung in `address_registry` und kein Persistenznachweis.
- `OrderID+ProductID` ist nur im synthetischen Fixture eindeutig, kein nachgewiesener allgemeiner Identitätsschlüssel.
- Abschlussbedingung: stabiler Identitätsvertrag oder explizite Kennzeichnung als rein physischer Locator; getestete Revisionen, Kollisionen und Parent-Bezüge.

## Kreis 2 – Gemeinsamer Prüfvertrag: TEILWEISE BELEGT
- `tests/edifact/checkpoint-contract.mjs` bündelt synthetische, read-only Vergleichsfunktionen.
- Unterscheidet `missing`, `added`, `changed`, blockiert doppelte Identitäten und manipulierte Checkpoint-Daten.
- Der Vertrag ist noch Northwind-Zeilenform-spezifisch (`OrderID`, `ProductID`, `Quantity`) und nicht in die produktive Address Layer eingebunden.
- SHA-256 über lokal serialisierte Zeilen belegt weder Quellenauthentizität noch tatsächlichen Empfang.

## Kreis 3 – Northwind/EDIFACT gemeinsames Adressschema: TEILWEISE BELEGT
- `buildAddressLayerProjection` und `projectStinoDinoSourceAddresses` liefern beide `rootAddress` und `addresses` mit `address`, `parentAddress`, `kind`, `sourcePath`.
- `tests/edifact/address-layer-cross-format-closure.test.mjs` prüft diese gemeinsame Form, Eindeutigkeit und Parent-Verweise.
- EDIFACT-Segment-Locator und Northwind-Index-Locator sind **keine** automatisch gleichwertigen stabilen Geschäftsidentitäten.
- Keine allgemeine formatübergreifende Identitätsauflösung, keine bestätigte Fachsemantik.

## Kreis 4 – IST und Freigabe: OFFEN
- Alle beschriebenen Änderungen sind auf dem Testbranch, keine Migration, kein Merge, kein Deployment.
- Externer RE-EX-/ZIP-Bericht steht aus und wird nicht als Nachweis gewertet.
- End-to-End mit realen unabhängig erfassten Checkpoints, verifizierter System-/Umgebungsidentität und geprüfter Freigabekette fehlt.
- Nächste Reihenfolge: (1) physische vs. logische Adresse im gemeinsamen Vertrag trennen, (2) formatübergreifende Beobachtung mit unveränderten Rohwerten testen, (3) vollständige CI-/IST-Abnahme. Keine neue Sonderarchitektur.

## Grundsatz
**LESEN → ÜBERSETZEN → ADRESSIERBAR MACHEN.**
Ein Kreis wird nur bei Code + ausgeführtem Test + begrenztem Nachweis geschlossen. Offen bleibt offen.


## Nachprüfung: Scope ist nicht Herkunft (Commit f043cdb)
- Ein Vergleich verlangt gleiche caller-gelieferte System-, Umgebungs-, Quellen- und Auftragsbezeichnungen sowie verschiedene Snapshot-IDs.
- **Negativtest:** Fremde Beobachtungswerte mit identisch gesetzten Labels passieren die Vergleichsform, bleiben aber ausdrücklich `unverified_synthetic_fixture` und `releaseAllowed: false`.
- Das ist eine **offene Vertrauensgrenze**, kein fehlgeschlagener Test und kein Herkunftsnachweis.
- Kreisabschluss erfordert unabhängige Erfassung/Bindung von Snapshot, Quelle und System sowie überprüfbare Integrität und Autorität. Keine automatische Freigabe auf Basis selbstdeklarierter Labels.

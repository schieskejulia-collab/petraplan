# Neuvalidierung: Kandidaten sind keine Bedeutungsbelege

Die Live-Neuvalidierung übernahm `STATUS=…` und `MENGE=…` aus bestätigten Kandidaten in einen neuen Bridge-Eingang. Dabei konnte eine neue bestandene Validierung entstehen, ohne den zugehörigen Claim und eine genehmigte Bedeutungsregel zu prüfen.

Der Endpunkt bleibt authentifiziert, prüft weiterhin den verarbeiteten Snapshot und die Review-Berechtigung und liest jetzt die Claims für den Fall. Er liefert HTTP 409 mit `SEMANTIC_EVIDENCE_REQUIRED`, `evidence_state: UNKNOWN` und konkreten Blockern. Er schreibt dabei weder Quellwerte noch Validation, Conflict, Review oder Release. Auch ein als `CONFIRMED` gespeicherter Claim mit `rule_id` und `rule_version` ist kein Ersatz für die Prüfung des Regelbelegs.

Die Blocker unterscheiden fehlende oder mehrdeutige Claims, ungeklärten Claim-Status, abweichenden Fall-/Snapshot-Scope, fehlende Regelversion und ungeprüfte Regelautorität. `UNKNOWN` heißt fehlende Prüfbarkeit; es behauptet weder, dass kein Beleg existiert, noch dass die Aussage falsch ist.

## Bewusste Grenze

Dies implementiert die sichere Sperre, **keine positive fachliche Neuvalidierung**. Sämtliche bestätigten Kandidaten in diesem Live-Pfad bleiben bis zur ausführbaren Regel-/Claim-Prüfung gesperrt. Der frühere ungeprüfte Mapping-Helper wurde entfernt. Eine bestehende fehlgeschlagene oder bestandene Validation wird nicht umgeschrieben. Bestehende historische Releases werden durch diese Änderung allein nicht nachträglich widerrufen; ein Audit früherer kandidatengestützter Validierungen ist eine getrennte Aufgabe.

Der Genehmigungsweg ist inzwischen in [Regel-Governance](semantic-rule-governance.md) implementiert; er bestätigt keine Claims automatisch. Die Voraussetzungen für einen späteren positiven Pfad stehen in `semantic-rule-candidate-review.md`: persistierte unveränderliche Regelversion, eindeutige Quelle und Zielgröße, geprüfte Belege und Gegenbeispiele, nachgewiesene fachliche Berechtigung für den konkreten Scope sowie explizite Claim-Prüfung. Die Basis muss beim Speichern einer Validation atomar gegen konkurrierende Änderungen geprüft werden. Danach sind neues Review und separate Freigabe erforderlich. Bloßes Entfernen dieser Sperre oder Hinzufügen einer Referenz darf keinen positiven Pfad erzeugen.

## Prüfung und Bereitstellung

`npm run test:decision-integrity` führt den tatsächlichen Neuvalidierungs-Endpunkt mit einem kontrollierten Client aus. Die Tests verlangen bei allen ungeprüften Zuständen null Schreiboperationen und einen unveränderten Quell-/Validation-Kontext. Die vorhandenen SQL-Tests für Freshness, Widerruf und getrennte Freigabe laufen weiterhin.

Diese Änderung benötigt keine Datenbankmigration. Sie aktiviert keine fachliche Regel und wurde nicht auf die Live-App bereitgestellt.

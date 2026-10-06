# Prüfschema für fachliche Regel-Kandidaten

Status: **Spezifikation, nicht implementierter Regelkatalog**. Dieses Dokument aktiviert keine Bedeutungsregel und ändert weder Claim-, Review- noch Release-Gates. Insbesondere ist `ShippedDate -> STATUS=GESCHLOSSEN` keine genehmigte Northwind-Regel. Die auf `northwind-proof-only` begrenzte Testautorität bleibt ein Test des Lebenszyklus, kein fachlicher Beleg.

Die Live-Neuvalidierung sperrt die Anwendung bestätigter Kandidaten bis zur Implementierung der fachlichen Regelprüfung. Fehlende Claims, ungeklärter Status oder ungeprüfte Regelautorität bleiben `UNKNOWN` und erzeugen keine neue Validation. Details und Grenzen: [Neuvalidierungs-Sperre](revalidation-semantic-evidence-gate.md).

## 1. Grenze und Begriffe

Ein beobachteter Quellwert ist Source Truth für den erfassten Datenstand. Eine vorgeschlagene Bedeutung im Bridge-Ziel ist zunächst ein Kandidat. Eine bestätigte Kandidatenentscheidung, ein Claim, eine genehmigte Bedeutungsregel, eine bestandene Validierung, ein Review und ein Release sind verschiedene Entscheidungen; keine davon folgt automatisch aus der jeweils vorherigen.

`RuleCandidate.status` in diesem Dokument ist **nicht** `claims.status` und **nicht** `review_rules.active`. Die bestehende Claim-Tabelle kennt etwa `UNPROVEN`, `SUPPORTED` und `CONFIRMED`, außerdem `rule_id` und `rule_version`. Die bestehenden `review_rules` beschreiben den Review-Ablauf. Ein persistierter Katalog fachlicher Bedeutungsregeln und die hier beschriebenen Übergänge existieren derzeit nicht. `PROVEN` ist kein bestehender Claim-Status.

## 2. Vorschlag und Nachweise

Ein Vorschlag hat mindestens diese Felder. Freitext allein ist keine ausführbare Regel.

| Feld | Erforderliche Bedeutung |
| --- | --- |
| `id`, `version`, `status` | Stabile ID, unveränderliche Version; anfangs `PROPOSED`. |
| `question`, `sourceIdentity`, `targetIdentity` | Welche fachliche Frage und welche eindeutig adressierten Quell- und Zielgrößen betroffen sind. |
| `condition`, `conclusion` | Prüffähige Bedingung und genau die behauptete Schlussfolgerung; Nullwerte und Gegenbeispiele benennen. |
| `scope`, `scopeDetails` | Etwa `CASE_ONLY`, `DATASET_ONLY` oder `SOURCE_SYSTEM`, mit Fall, Datensatz-/Snapshot-Version, Zeitraum und Systemversion, soweit relevant. Kein stilles Ausweiten des Geltungsbereichs. |
| `justification`, `evidenceReferences` | Fachliche Begründung und auffindbare Belege für **die Ableitung**, nicht nur für den Quellwert. |
| `limitations`, `exceptions`, `unresolvedItems` | Bekannte Gegenbeispiele, unvollständige Quellabdeckung und offene Fragen. |
| `proposedBy`, `proposedAt` | Urheber und Zeitpunkt. Ein System darf vorschlagen, aber dadurch keine Autorität behaupten. |
| `reviewerRole`, `reviewedBy`, `reviewedAt`, `reviewReason` | Dokumentierte Entscheidung einer für genau diesen Geltungsbereich berechtigten fachlichen Rolle. |

Ein Vorschlag darf weder einen Quell-Snapshot umschreiben noch `claims.status` ändern noch eine Freigabe auslösen. Die vorgeschlagene Bedingung wird an den Quellwerten und bekannten Gegenbeispielen getestet; das Testergebnis belegt für sich allein noch keine fachliche Bedeutung.

## 3. Prüfung und Zustände

`PROPOSED -> APPROVED` ist nur als explizite, versionierte Entscheidung zulässig. Die berechtigte fachliche Rolle muss für den konkreten Scope nachgewiesen sein. Eine technische Projektrolle oder der Besitz eines Datensatzes allein genügen nicht als Beleg fachlicher Autorität. Eine Entscheidung für einen Fall gilt nicht automatisch für das ganze Dataset oder das Quellsystem.

Vor `APPROVED` prüft der Reviewer:

1. Identitäten, Bedingung, Schlussfolgerung, Scope und Zeitraum sind eindeutig und widerspruchsfrei.
2. Die Belege tragen die **behauptete Bedeutung**; die bloße Existenz oder Lesbarkeit eines Quellwerts reicht nicht.
3. Erforderliche Quellen wurden im Fragekontext geprüft; fehlende Abdeckung bleibt `UNKNOWN` und wird nicht zu `NOT_FOUND` oder `FALSE` umgedeutet.
4. Gegenbeispiele, Ausnahmen, Nullwerte, widersprechende Regeln und mögliche Informationsverluste sind geklärt oder begrenzen den Scope ausdrücklich.
5. Die Entscheidung mit Rolle, Person, Begründung, Belegen und Zeitpunkt ist nachvollziehbar und reproduzierbar.

Scheitert eine dieser Bedingungen, bleibt der Kandidat `PROPOSED` oder wird begründet `REJECTED`. Eine genehmigte Regel gilt nur in ihrem dokumentierten Scope und ihrer Version. Spätere Änderungen erzeugen eine neue Version; `REVOKED` beziehungsweise `SUPERSEDED` bewahrt die frühere Entscheidung historisch und löst eine Prüfung abhängiger Claims, Validierungen, Reviews und Releases aus. Diese Abhängigkeitsprüfung ist hier eine Anforderung für eine spätere Implementierung, keine Behauptung über bereits vorhandene Automatik.

Auch `APPROVED` bestätigt keinen einzelnen Claim automatisch. Für einen konkreten Fall sind dessen Belege und Scope erneut zu prüfen. Eine neue oder geänderte Claim-Basis erfordert die bestehende Reihenfolge aus Neuvalidierung, neuem Review und separater Freigabe. Es gibt keinen Übergang `APPROVED rule -> release`.

## 4. Beispiel A-10266: absichtlich offen

- Beobachtet: `NW:A-10266#ShippedDate = 1996-07-31` im festgelegten Northwind-Snapshot.
- Vorgeschlagen: Aus einem vorhandenen Versanddatum könnte für diesen Fall `STATUS=GESCHLOSSEN` abgeleitet werden.
- Nicht belegt: Eine zuständige fachliche Definition, nach der *versendet* in diesem Scope *geschlossen* bedeutet.
- Ergebnis: Der Regel-Kandidat bleibt `PROPOSED`; er erhält hier weder eine fachliche Autorität noch `APPROVED`. Der bestehende Claim bleibt als eigener Datensatz `UNPROVEN`. Der aktuelle Fall ist wegen der nach der Validierung geänderten Claim-Basis gesperrt. Seit PR #50 sperrt zusätzlich ein ungelöster `SEMANTIC_MAPPING`-Claim in `DRAFT`, `UNPROVEN`, `SUPPORTED` oder `CONTESTED` ein genehmigtes Review und ein neues Release, auch nach einer frischen Validierung. Diese technische Sperre genehmigt selbst keine Bedeutungsregel.

**Quellengrenze für diese Frage:** Der verwendete `neo4j-contrib/northwind-neo4j`-Datensatz enthält für A-10266 ein `shippedDate` vom 1996-07-31, aber keine Statusdefinition, aus der `Closed` folgen würde ([CSV-Zeile](https://github.com/neo4j-contrib/northwind-neo4j/blob/master/data/orders.csv)). Microsoft beschreibt in der *Northwind 2.0 Developer Edition* `Shipped` und `Closed` als getrennte Workflow-Zustände ([Dokumentation](https://support.microsoft.com/en-us/access/northwind-2-0-developer-edition-orders)). Diese andere Version ist keine Autorität für den festgelegten CSV-Snapshot; sie warnt nur davor, Versand und Abschluss ohne Scope-Nachweis gleichzusetzen. Der Bedeutungsbeleg bleibt `UNKNOWN`.

## 5. Abnahmeszenarien für eine spätere Umsetzung

| Fall | Erwartung |
| --- | --- |
| Quellwert vorhanden, Bedeutungsbeleg fehlt | `PROPOSED`; keine automatische Claim-Bestätigung oder Freigabe. |
| Reviewer ohne nachgewiesene fachliche Berechtigung für den Scope | `APPROVED` wird verweigert. |
| Fallregel wird auf andere Fälle angewendet | Anwendung wird verweigert; gesonderte Scope-Prüfung nötig. |
| Gegenbeispiel oder benötigte Quelle ungeklärt | Offene Frage bleibt sichtbar; keine Genehmigung über den ungeklärten Bereich. |
| Genehmigte Regel wird geändert oder widerrufen | Frühere Version bleibt lesbar; abhängige Entscheidungen werden auf neue Gültigkeit geprüft. |
| Regel genehmigt, Claim oder Review veraltet | Keine direkte Freigabe; bestehende Validierungs-, Review- und Release-Gates bleiben maßgeblich. |

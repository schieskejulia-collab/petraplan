# Fachliche Regelvorschläge und Entscheidungen

## Implementierter Umfang

Der Fall-Endpunkt `/api/cases/:recordId/semantic-rules` bietet einen persistierten Genehmigungsweg für **CASE_ONLY + genau einen Quell-Snapshot**:

- `propose`: neue Regelversion mit Frage, Bedingung, Schlussfolgerung, Begründung, Belegreferenzen, Grenzen, Ausnahmen und offenen Fragen. Quelladresse, Quellpfad, Zieladresse und vorgeschlagener Wert stammen serverseitig aus Claim und Kandidat. Ein Fingerabdruck bewahrt die fachliche Claim-Grundlage.
- `approve` / `reject`: ausdrückliche Entscheidung einer für Fall, Snapshot und Zielgröße fachlich berechtigten Person. Eine technische Bridge-Reviewer-Rolle genügt nicht. Alle erforderlichen Kriterien müssen bei Genehmigung ausdrücklich `true` sein. Offene Fragen, reine Quellbelege, veränderte Grundlagen und alte Snapshots sperren `APPROVED`.
- `revoke` / `supersede`: endgültige negative Entscheidung für eine zuvor genehmigte Version. Ein Widerruf wird nicht rückgängig gemacht. Ein neuer Vorschlag erzeugt eine neue Version; er genehmigt und ersetzt die alte nicht automatisch.
- `GET`: Regelversionen mit Status, Entscheidungen, historischer Rollen-/Berechtigungsreferenz und der gültigen Entscheidungsberechtigung der aktuellen Anmeldung.

Die mobile Live Bridge enthält Formular, Belege, Prüfkriterien, Entscheidungshistorie und Vorbereitung neuer Versionen. Fehlende Datenbankbereitstellung wird als Fehler angezeigt und nicht als leerer Katalog ausgegeben.

## Unveränderliche Historie und Berechtigungen

`semantic_rule_versions` und `semantic_rule_decisions` sind append-only. Trigger verweigern Updates und Löschungen. Proposal und Entscheidung laufen jeweils als eine Datenbanktransaktion. Die Datenbank prüft Fall, Snapshot, Rollen und Grundlage erneut unter derselben Fallsperre; eine direkte Service-Insertion umgeht die Prüftrigger nicht.

`semantic_rule_authorities` enthält administrativ hinterlegte, unveränderliche fachliche Delegationen: Benutzer, Fall, Snapshot, Zieladresse, Rolle, Berechtigungsbeleg, delegierende Person und Gültigkeitsende. Diese Angaben sind nachzuweisen, nicht aus einer Projektrolle abzuleiten. Eine neue Delegation kann nach Ablauf ergänzt werden.

Der Web-Endpunkt bietet **keine Selbstzuweisung** und keinen Grant-Schreibpfad. `service_role` hat auf Delegationen und deren Widerrufen ausschließlich SELECT; `anon` und `authenticated` haben weder Tabellenzugriff noch RPC-EXECUTE. Alle neuen Tabellen verwenden RLS. RPCs sind `SECURITY INVOKER` mit leerem `search_path`, ohne Actor aus User-Metadata. Die Actor-ID stammt ausschließlich aus der serverseitig geprüften Sitzung.

Administratoren können eine Delegation über eine neue Zeile in `semantic_rule_authority_revocations` widerrufen. Der unveränderliche Administratorbeleg widerruft die damit aktuell genehmigten Regelversionen in derselben Transaktion. Die öffentliche RPC bietet keinen Parameter für automatische Ereignisse; der Trigger verlangt den echten Administratorbeleg.

Keine Delegation, Regelgenehmigung oder Bedeutungsreferenz wird automatisch für Julia oder A-10266 angelegt. Provisionierung echter fachlicher Berechtigung ist eine separate administrative Entscheidung anhand eines tatsächlichen Nachweises.

## Auswirkungen auf bestehende Entscheidungen

Ein negativer Regelentscheid ergänzt für ausdrücklich über `claims.rule_id` und `claims.rule_version` verknüpfte Claims einen qualifizierenden Beleg (`SEMANTIC_RULE_DECISION`, `QUALIFIES`). Die vorhandenen Belegtrigger verändern damit den Claim-Basis-Hash und widerrufen nutzbare Releases atomar. Historische Zertifikate, Claim-Aussagen und Quell-Snapshots bleiben erhalten. Scheitert der Beleg-/Audit-Schreibvorgang, wird auch der Regelentscheid zurückgerollt.

Eine positive Regelgenehmigung schreibt weder Claim-Status noch Validation, Review oder Release. Insbesondere wird ein `UNPROVEN`-Claim nicht durch die Genehmigung einer Regel `CONFIRMED`.

## Grenzen

Dies ist **Regel-Governance**, noch kein ausführbarer Regel-Interpreter. Bedingung und Schlussfolgerung werden als prüfbare Beschreibungen gespeichert und von einer fachlich berechtigten Person bewertet. Ein Formularfeld oder ein angekreuztes Kriterium ist kein automatisch verifizierter externer Beleg. Der Endpunkt lädt externe Dokumente nicht selbst und beweist nicht selbst deren fachliche Aussage.

Die Neuvalidierungs-Sperre bleibt deshalb bestehen. Der nächste eigene Implementierungsschritt ist die konkrete Claim-Prüfung gegen genehmigte Regelversion, tatsächliche Belege, Scope und Quellwerte sowie deren atomare Bindung an die neue Validation. Ein genehmigter Regelstatus allein darf diesen Pfad nicht öffnen.

Delegationsablauf sperrt neue Entscheidungen sofort. Historische Genehmigungen bleiben sichtbar; der Ablauf einer Uhrzeit erzeugt noch keinen selbsttätigen Datenbank-Schreibvorgang. Vor einer späteren Ausführung muss deren aktuelle Gültigkeit erneut geprüft und ein Ablauf für die Entwertung bereits konsumierter Regeln implementiert werden. Dieser PR konsumiert keine Regeln in positiven Entscheidungen.

Parallelzugriffe wurden in PGlite sequenziell geprüft; Locks und atomare Rollbacks sind vorhanden, ein Last-/Race-Test auf einem echten PostgreSQL-Server steht vor Live-Bereitstellung noch aus. Das PGlite-Fixture ersetzt keinen Abgleich mit dem Live-Schema.

## A-10266 als offener Fall

Beobachtung: ein Versanddatum im Northwind-Snapshot. Vorschlag: daraus `STATUS=GESCHLOSSEN` abzuleiten. Offene Frage: welche fachliche Definition trägt diese Bedeutung im konkreten Scope? Ohne diesen Beleg bleibt der Regelvorschlag `PROPOSED` und der Claim `UNPROVEN`.

Der synthetische positive Test im SQL-Fixture belegt ausschließlich den Genehmigungsmechanismus. Er ist keine genehmigte Northwind-Regel und keine Live-Datenänderung.

## Migration und Validierung

Migration: `supabase/migrations/20261006121534_semantic_rule_governance.sql`, mit `supabase migration new` angelegt. Sie setzt den bestehenden Address-/Claim-Layer und die Freshness-Migrationen voraus. Sie wurde nur in isolierten PostgreSQL/PGlite-Fixtures ausgeführt, nicht auf Supabase live angewendet.

Vor Bereitstellung: im richtigen Projekt vorhandene Tabellen/Spalten und Trigger abgleichen, Migration in einer entsprechenden Testdatenbank ausführen, Berechtigungen und Supabase-Advisors prüfen, danach das authentifizierte Formular gegen diese Datenbank testen. Es gibt keinen Fallback auf Browser-Schreibrechte oder ungeprüfte Kandidaten.

Prüfbefehle: `npm test`, `npm run test:decision-integrity`, `npm run typecheck --prefix frontend/mobile-app`, `npm run build --prefix frontend/mobile-app`. 116 Backend-Tests und 91 Entscheidungstests bestehen, ebenso Typecheck und Build. Die mobile Ansicht ist noch nicht visuell im Browser verifiziert: `agent-browser` konnte hier nicht starten; der Browser-Download scheiterte anschließend an einem TLS-Zertifikatsfehler. Ein Live-Nachweis wird daraus nicht abgeleitet.

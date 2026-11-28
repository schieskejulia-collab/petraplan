# Verbindliche Dublettenprüfung: Sicherheitsvertrag

Arbeitsstand 28.11.2026, auf PR #66, noch nicht gemergt oder bereitgestellt.

Der bisherige lesende Vergleich ist kein Freigabeschutz. Die nächste Änderung
muss folgende Bedingungen gemeinsam erfüllen; eine bloße Schaltfläche genügt nicht.

1. Unveränderliche Prüfentscheidung mit Akteur, Grund, Belegreferenz, aktuellem
   Snapshot und Fingerprint des gesamten verglichenen Projektbestands.
2. Automatische Vergleichsbewertung wird ausschließlich serverseitig erzeugt;
   der Browser darf keine Trefferliste oder Abdeckungsbehauptung vorgeben.
3. Fehlende/unbrauchbare Belege oder abgeschnittene Vergleiche erlauben keine
   reguläre Freigabe. Keine Ergebnisse bedeutet keine automatische Entwarnung.
4. Explizite Entscheidungen: CLEAR (vollständiger Vergleich ohne Verdacht),
   DISTINCT (belegt eigenständige Vorgänge), DUPLICATE (diesen Fall sperren), HOLD.
   Identische XML darf nicht als DISTINCT erklärt werden. Für die Referenzfassung
   ist PRIMARY erst zulässig, wenn sämtliche gefundenen Kopien durch aktuelle
   DUPLICATE-Entscheidungen gesperrt sind.
5. DISTINCT und PRIMARY brauchen eine ausdrücklich bestellte, unabhängige
   Entscheidungsperson mit dokumentierter Vollmacht. Bestehende technische
   can_review/can_release-Rollen allein verleihen diese Befugnis nicht.
6. Die Freigabe bindet die genaue Entscheidung einschließlich der gesperrten
   Kopien. Ein neuer/ersetzter Fall, geänderte relevante Quelldaten, eine andere
   Entscheidung zu einer Kopie oder entzogene Befugnis machen diese Grundlage
   unbrauchbar. Historische Zertifikate werden dabei nicht umgeschrieben.
7. Erfassung, Entscheidung und Freigabe müssen denselben Datenbank-Lock verwenden,
   vor dem jeweiligen Fall-Lock. Die Freigabe prüft innerhalb ihrer Transaktion
   neu. Reine UI-/API-Prüfungen schließen das Rennen nicht.
8. Eine Wiederholung der Freigabe darf die Prüfung nicht über einen vorhandenen
   Zertifikatseintrag umgehen. Aktuelle Statusabfragen müssen veraltete
   Freigabegrundlagen als BLOCKED zeigen, ohne einen Widerruf vorzutäuschen.
9. Neue Prüfung erzeugt weder automatisch ein Review noch ein Zertifikat.
   Vorhandene Rechnungs-, Claims-, Review- und PDF-Ausnahmebedingungen gelten weiter.

Projektweiter Pilot: keine Mandantentrennung. Höchstens 200 andere Fälle. Die
gehostete Abnahme mit tatsächlichen Rollen, SQL-Definitionen und zwei echten
Identitäten bleibt separat. Northwind/27 wird nicht wieder geöffnet.

## Obligatorische Gegenproben

- Eine technisch freigabefähige Rechnung bleibt ohne Dublettenentscheidung gesperrt.
- Vollständiger Vergleich, bewusste CLEAR-Entscheidung, getrenntes Review und
  anschließende Freigabe funktionieren; kein früherer Schritt erzeugt Zertifikate.
- Nachträglicher neuer Fall: alter Fingerprint darf keine neue Freigabe erlauben,
  vorhandene Freigabe wird als nicht aktuell dargestellt.
- Neues/ersetztes Original vor oder während Freigabe, in beiden Commit-Reihenfolgen.
- Zwei getrennte PostgreSQL-Verbindungen: Erfassung/Freigabe und Entscheidung/
  Freigabe; Commit und Rollback. Keine Phantom-Freigabe.
- Direkter RPC-/Zertifikatsschreibversuch darf die Sperre nicht umgehen.
- Falscher Snapshot, fehlende Rolle, fehlende Befugnis, Selbstentscheidung,
  gefälschte Treffer/Abdeckung und veraltete Kopienentscheidung bleiben gesperrt.
- Identische Kopie: DUPLICATE sperrt den Kopiefall; PRIMARY erlaubt höchstens die
  belegte Referenzfassung bei weiterhin aktueller Sperre der Kopie.

## Implementierungsstand und bestehende Rechte

Die beiden Migrationen `20261128050000_invoice_duplicate_decisions.sql` und
`20261128051000_invoice_duplicate_release_guard.sql` ergänzen unveränderliche
Entscheidungen, Bestandsfingerprint, Datenbank-Lock und Zertifikatsbindung.
Die ursprünglichen Capture-/Release-Implementierungen sind hinter festen,
serverseitigen Einstiegspunkten gekapselt. Die internen Funktionen sind nicht
mehr durch `service_role`, Browserrollen oder PUBLIC direkt ausführbar. Die
Security-Definer-Einstiege haben einen leeren search_path und rufen ausschließlich
feste Funktionen mit typisierten Parametern auf; vorhandene Akteursprüfungen bleiben.

Der eingetragene Prüfentscheid wird nach einer monotonen Identität ausgewählt,
nicht nach zufälligen UUIDs oder gleichen Zeitstempeln. Die API erzeugt ihre
Bewertung neu aus SQL-Belegen; Browserangaben zu Treffern werden ignoriert.
`service_role` bleibt ein vertrauenswürdiger Anwendungstransport, wie beim
bestehenden Worker. Beliebige öffentliche Service-RPC-Weiterleitungen sind unzulässig.

DISTINCT/PRIMARY sind standardmäßig für sämtliche bestehenden Akteure deaktiviert.
Nötig sind `can_adjudicate_invoice_duplicates`, eine dokumentierte
`invoice_duplicate_authority_reference` und Unabhängigkeit vom Upload sowie von
bisherigen Reviews des Falls. Rollenentzug und eine geänderte Vollmachtsreferenz
machen die Entscheidung unbrauchbar. Die Software prüft Benutzeridentitäten,
keine Identität verschiedener Menschen hinter mehreren Konten.

Der Bestandsfingerprint bindet maximal 201 aktuelle Rechnungsfälle (Ziel plus
200 andere). Größere oder unvollständige Bestände erlauben keine positive
Entscheidung; die Sperrentscheidungen HOLD/DUPLICATE bleiben möglich.
Alle Änderungen an records, ingestion_logs, validation_results und bridge_invoice_evidence werden
konservativ projektweit serialisiert. Nur READ COMMITTED wird unterstützt.
Das ist ein bewusst enger Pilotumfang, kein skalierbares Mandantenmodell.

Die neue SQL-Prüffunktion `bridge_check_invoice_duplicate_release` muss für
aktuelle Freigabeaussagen benutzt werden. Das bestehende `bridge_current_release`
bleibt ein historischer Zertifikats-/Widerrufsauswahlschritt und genügt allein
nicht als Nachweis aktueller Dublettenfreiheit. Fallansicht und Fallliste prüfen
zusätzlich die im Zertifikat gebundene Entscheidung. Ein solchermaßen gebundenes
Zertifikat wird auch nach Abschalten des API-Schalters weiterhin geprüft.

Eine veraltete Freigabe wird BLOCKED angezeigt, nicht rückwirkend als widerrufen
umgeschrieben. Vor einer neuen Freigabe: ausdrücklich widerrufen, aktuelle
Dublettenentscheidung speichern, dann separat freigeben. Ein bisheriges
Quellenreview kann dabei nur weiterverwendet werden, wenn die unveränderten
Snapshot-, Validierungs-, Claims- und übrigen Review-Prüfungen weiterhin bestehen.
Ein bereits widerrufenes Zertifikat bleibt terminal; ein neuer Bestandsentscheid
ist eine zusätzliche Freigabegrundlage für ein neues Zertifikat.

## Bereitstellung ist nicht ausgeführt

Nur die ausdrücklich vorgesehene nichtproduktive Einzelprojekt-Umgebung verwenden.
Vorher das tatsächliche Schema und die Rollen prüfen. Beide Migrationen zusammen
in einer kontrollierten Transaktion installieren und serverseitig gleichzeitig
`PETRAPLAN_INVOICE_DUPLICATE_SCOPE=single-project-pilot` sowie
`PETRAPLAN_INVOICE_DUPLICATE_ENFORCEMENT=1` setzen. Keine Migration einzeln ausrollen.
Bisherige Zertifikate ohne Dublettenbindung werden im eingeschalteten Pilotbetrieb
nicht als aktuell anerkannt. Vorhandene echte Daten nicht automatisch nachtragen.
Nicht die ganze historische Migrationsliste blind anwenden.

Der neue Browserlauf verwendet echte Upload-, KoSIT-, Entscheidungs-, Status- und
Freigabewege, aber lokale Testidentitäten und PGlite. Neue PostgreSQL-17-Rennen
stehen in `tests/postgres/invoice-duplicate-enforcement.test.mjs`. Ihr Ergebnis
ist separat am aktuellen CI-Commit festzuhalten, ebenso gehostete Anmeldung und
Gesamtabnahme. PRs bleiben gemäß Nutzeranweisung ungemergt.

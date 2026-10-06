# Claim-bezogene Prüfanforderungen

## Ziel und Grenze

Für eine konkrete Aussage festhalten, welche Information benötigt wird, was sie stützen oder widerlegen könnte und welche Prüfung als Nächstes aussteht. Fehlende Daten sind UNKNOWN, keine implizite Verneinung. Dieser Schritt ist persistierte Prüfplanung mit von Reviewern berichteten Beobachtungen, kein GAF, keine automatische fachliche Evaluation und keine neue Freigabegrundlage.

Die Northwind-Beispiele liefern keine neue Geschäftsregel: Versanddatum bedeutet nicht automatisch geschlossen, und eine einzelne sichtbare Positionsmenge beweist weder Vollständigkeit noch die fachliche Kopfmenge.

## Datenmodell

`claim_check_requirements`: ID, Claim-ID, Fall-ID, Snapshot-ID, serverseitiger Claim-Basis-Fingerabdruck, vorherige Anforderung, Frage, benötigte Information, benötigte Feldadresse, stützende Bedingung, Gegenbedingung, Vollständigkeitsanforderung, Abwesenheitspolitik UNKNOWN, nächster Schritt, authentifizierter Ersteller und Zeitpunkt.

Eine Fundstelle darf noch nicht im Adressregister vorkommen: fehlende Quelldaten sollen gerade angefordert werden können. Sie ist deshalb zunächst eine vorgeschlagene Adresse, kein behaupteter Existenznachweis. Bedingungen sind explizite Texte; ein ausführbarer und fachlich genehmigter Prüfer ist ein späterer Schritt.

`claim_check_observations`: unveränderliche ID und Reihenfolge, Anforderungs-ID, tatsächliche Representation-Evidence-ID, vom Server eingefrorene Belegfassung, berichtetes Ergebnis MISSING/UNKNOWN/SUPPORTS/CONTRADICTS, Vollständigkeitsstatus und Referenz, Begründung, authentifizierter Reviewer und Zeitpunkt. SUPPORTS/CONTRADICTS benötigen eine vorhandene Feld-Evidence desselben Falls, Snapshots und exakt derselben Feldadresse. SUPPORTS verlangt zusätzlich COMPLETE mit nichtleerem Vollständigkeitsverweis. Diese Referenz ist noch kein maschinell verifizierter Vollständigkeitsnachweis. Ein bereits vorhandener Feldbeleg darf nicht gleichzeitig als MISSING berichtet werden; ein leerer/null Quellwert muss ausdrücklich interpretiert werden.

Definitionen und Berichte sind append-only. Änderungen erzeugen eine neue Anforderung mit previous_requirement_id, keine Überschreibung. Eine Definition kann höchstens einmal ersetzt werden. Revisionen behalten Claim, Fall und Snapshot; bei einem neuen Snapshot/Claim ist eine neue Anforderung nötig. Alte Berichte bleiben mit ihrer ursprünglichen Belegfassung lesbar.

## API und mobile Ansicht

`GET /api/cases/:recordId/claim-checks`: Anforderungen, gesamte Prüfhistorie und Feldbelege. Read-only Planstatus UNASSESSED/MISSING/UNKNOWN/SUPPORTS/CONTRADICTS/STALE/SUPERSEDED. Kein angelegter Eintrag bedeutet nicht vollständig geprüft. Vorhandener Beleg bedeutet nicht bestandene Bedingung. Geänderter Claim-Basis-Hash, Snapshot oder verwendeter Beleg macht den Bericht STALE; ersetzte Anforderungen geben keine neue Aufgabe aus. Technische Reviewer dürfen Prüfberichte erfassen, verleihen damit aber keine fachliche Autorität.

`POST action=add`: Claim-ID, Definition, optional previous_requirement_id. Actor stammt ausschließlich aus serverseitig verifizierter Anmeldung. Ein atomarer RPC friert die aktuelle Basis ein.

`POST action=record`: requirement_id und observation. Ein atomarer RPC prüft Rolle, Scope, aktuelle Grundlage und genaue Belegidentität. Clientwerte für evidence_snapshot werden nicht übernommen.

Die mobile Live Bridge zeigt ein Formular, Gegenbedingungen, offene nächste Schritte, Quellbelege inklusive Snapshot und Hash sowie die unveränderliche Berichtshistorie. STANDARD ist UNKNOWN, keine voreingestellte Bestätigung. Fehlende Migration wird als Fehler angezeigt, nicht als leerer oder erfolgreicher Katalog.

## Sicherheit und Auswirkungen

Nur CASE_ONLY mit aktuellem processed Snapshot und aktiven Claims. DB-Trigger prüfen auch direkte Service-Inserts unter der Fallsperre. RLS auf beiden Tabellen; anon/authenticated/PUBLIC ohne Tabellen- und RPC-Rechte. Service hat nur SELECT/INSERT auf neuen Tabellen. Funktionen SECURITY INVOKER, leerer search_path, kein user_metadata und kein vom Client wählbarer Actor.

Der Schritt verändert weder Quellpayload, Claim-Status/-Evidence, Validation, Review noch Release. Ein berichteter Gegenbeleg ist eine offene fachliche Prüfaufgabe, keine automatische Claim-Widerlegung oder Release-Revocation. Bevor diese Ergebnisse als operative Entscheidungsgrundlage genutzt werden, braucht es autorisierte Auswertung der Bedingungen, verifizierte Vollständigkeit, atomare Bindung der exakten Anforderungen/Berichte an Validation und ein Invalidation-Verfahren bei neuen Prüfanforderungen oder Gegenbelegen. Die vorhandene Revalidierungs-Sperre bleibt bestehen.

## Bereitstellung und Nachweise

Migration `20261006125308_claim_check_requirements.sql` wurde mit Supabase CLI migration new erzeugt und setzt die Governance-Migration aus PR52 sowie den bestehenden Representation-/Claim-Layer voraus. Keine Anwendung in Live-Supabase, keine echte fachliche Regel oder Delegation angelegt. SQL-Fixtures, API-Tests und Backend-Plan-Tests prüfen fehlende Daten, aktuelle Grundlage, falsche Belegidentität, Zugriff, Unveränderlichkeit und unveränderte Claims/Quellen. PGlite ersetzt keinen echten PostgreSQL-Race-Test oder Live-Schema-Abgleich.

Mobile Typecheck und Build prüfen den Code. Eine visuelle Browserprüfung steht aus; agent-browser war in dieser Umgebung zuvor nicht startfähig und der Browser-Download scheiterte an einem Zertifikatsfehler. Vor Rollout: passende Testdatenbank, Migration, Advisors und authentifizierter UI-Durchlauf.

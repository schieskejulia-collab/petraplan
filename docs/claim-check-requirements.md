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

## Vorlagen aus dem SAP Identity Management Master Guide

Die mobile Eingabe bietet vier auswählbare Vorlagen: Identitätszuordnung, Attribut-/Schema-Mapping, Datenverantwortung und Berechtigung/Funktionstrennung. Grundlage ist der hochgeladene SAP Identity Management Master Guide, Version 1.6 vom 17.05.2024: Abschnitt 3.2.9 Seite 20 (Virtual Directory und ID-/Attribut-Mapping), Abschnitt 5.1 Seite 27 (Rollen-/Data-Ownership-Modell) und Abschnitt 5.4 Seite 34 (Access Control und Risiko-/Funktionstrennungsprüfung).

Die konkreten Prüfkriterien sind unsere Ableitung aus diesen Architekturansätzen, keine von SAP vorgegebene Regel und kein Fallbeleg. Erst ein ausdrücklicher Übernehmen-Klick füllt einen bearbeitbaren Entwurf; Speichern bleibt ein eigener Schritt. Keine automatischen Claims oder Live-Einträge. Die erforderliche Adresse ist absichtlich leer und muss fallbezogen ergänzt werden. Weitere Eingangsgrößen brauchen weitere Anforderungen. Quelle und Hinweis stehen neben der Vorlagenauswahl; die gespeicherte Anforderung bewahrt die tatsächlich übernommenen beziehungsweise bearbeiteten Bedingungen, nicht eine automatisch behauptete Herkunft ihrer Fallbelege.

Mehrere Quell-IDs können legitime Aliasse oder erlaubte Zusammenführungen sein. Eine Kollision ist erst anhand der dokumentierten Identitätsregel und des Namensraums feststellbar. Quellenzuständigkeit beweist nicht den Quellwert. Technische Review-Rechte beweisen nicht fachliche Entscheidungsbefugnis. Der Ansatz verlangt keine SAP-IDM-Installation und übernimmt keine Provisionierungs- oder Schreibfunktion.

## Anmeldung auf der Vorschau-Fallliste

Die Fallliste zeigt ohne lokale Sitzung ein Anmeldeformular. Ein ausdrücklich angeforderter Magic Link wird weiterhin auf die stabile Produktionsadresse ausgestellt; alternativ kann der Benutzer den noch unverbrauchten Original-Anmeldelink aus der E-Mail direkt im Formular verifizieren oder einen von der Mailvorlage gelieferten Code eingeben. Supabase verifyOtp erzeugt die Sitzung auf der aktuellen Origin, ohne den Redirect aus dem Link aufzurufen. Für diese Alternative sind weder neue Redirect-Wildcards noch eine Änderung der Mailvorlage notwendig. Der Parser akzeptiert ausschließlich HTTPS-Verify-Links des konfigurierten Supabase-Projekts vom Typ email/magiclink, genau einen Token-Hash und keinen Session-Fragment; Recovery-/Fremdprojekt-Links werden zurückgewiesen. Authentifizierungsdaten werden nicht in Logs oder eigene Tabellen geschrieben. Die Fallliste lädt nach Auth-State-Änderungen neu. Standard-Rollenprüfungen in den APIs bleiben bestehen; kein anonymer Datenzugriff und keine automatische Kontoerstellung im neuen Formular.

Referenz: aktuelle Supabase-Dokumentation Passwordless email sign-in und Email Templates (am 06.10.2026 über search_docs geprüft). Der tatsächliche E-Mail-/Session-Durchlauf ist noch nicht im Browser verifiziert; Tests prüfen Parser-Grenzen, Typecheck und Build. Bereits geöffnete/abgelaufene Links und durch Scanner verbrauchte Links erfordern eine neue Anmeldung. Umschriebene Tracking-Links werden nicht verfolgt: benötigt wird der Original-Link aus dem richtigen Projekt.

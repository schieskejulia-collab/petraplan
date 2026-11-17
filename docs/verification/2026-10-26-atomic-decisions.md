# Zweiter Arbeitsschritt: atomare Entscheidungen

Ausgangsbasis ist PR #56 bei `d959526ca790123e586bfc34427f6d2f65c1f04c`.
Ziel dieses Schritts ist, Teilentscheidungen beim Speichern zu verhindern:
Review, Claim-Erstellung und Sicherheitswiderruf werden jeweils als eine
Datenbanktransaktion gespeichert. Eine fehlgeschlagene Teiloperation rollt
saemtliche Schreibvorgaenge derselben Operation zurueck.

## Konkrete bisherige Luecken

- Die Review-API schrieb Review-Record, Sitzung, Kriterien, Entscheidung,
  Statushistorie, Log und Audit mit einzelnen Requests. Bei den letzten drei
  Requests wurden Fehler nicht ausgewertet.
- Der verwendete Logtyp `authorized_mobile_decision` ist laut dem aktuell
  gelesenen Original-CHECK nicht erlaubt. Erlaubt ist u.a. `decision_committed`.
  Entsprechend verwendet der neue Widerruf den erlaubten Logtyp `revoked`.
- Die Claim-API versuchte einen spaeteren Fehler durch DELETE zu kompensieren.
  Bereits durch Claim-Trigger gespeicherte Widerrufe wurden dadurch nicht
  atomar mit dem Claim und seinen Belegen zurueckgenommen.
- Die JavaScript-Sicherheitsfunktionen schrieben Widerruf, Log und Audit
  separat. Teilweise wurden Log-/Auditfehler lediglich als Warnung gemeldet.

## Umsetzung

Die Entwicklungs-Migration `20261026162914_atomic_review_and_revocation.sql`
enthaelt vier Funktionen auf dem bestehenden Schema:

| Funktion | Vertrag |
| --- | --- |
| `bridge_current_release` | Lesende Auswahl der eindeutigen Zertifikats-/Historiengrundlage. Gleichstaende, fehlende Zeiten und historische terminale Reaktivierung sperren. |
| `bridge_commit_review` | Reprueft aktive technische Reviewer-Berechtigung, aktuellen Snapshot, aktuelle Validierung und Claim-/Evidence-Fingerprint. Speichert Record, Sitzung, explizite Kriterien, Entscheidung, Historie, erlaubtes Log und Audit gemeinsam. |
| `bridge_revoke_case` | Reprueft Berechtigung und konkrete Zertifikatsidentitaet. Manueller, negativ-validierungsbezogener und Claim-bezogener Widerruf speichern Historie, Log und Audit gemeinsam. Kein positiver Re-Release. |
| `bridge_create_explicit_claim` | Leitet Candidate-/Address-/Snapshot-Bezuege, Produzent und Belege serverseitig ab. Speichert den `UNPROVEN`-Claim und seine technischen Referenzen gemeinsam mit einer erforderlichen Freigabeentwertung. |

Alle Funktionen laufen als `SECURITY INVOKER` mit leerem `search_path`.
Direkter Aufruf durch `PUBLIC`, `anon` und `authenticated` wird entzogen;
der authentifizierende Server verwendet seine bestehende Service-Rolle.
Der Actor stammt aus `auth.getUser()` und wird nicht aus dem Request-Body uebernommen.
Die Datenbank prueft die aktuellen Rollen erneut. Rollen werden hierbei
**nicht** angelegt, erweitert oder als fachliche Autoritaet interpretiert.

Die API delegiert genau einen mutierenden RPC pro Aktion. Bei fehlender
Migration wird ein Bereitschaftsfehler gemeldet; es gibt keinen Rueckfall
auf die bisherigen Einzel-Schreibvorgaenge oder kompensierende DELETEs.

## Bindung und Wiederholungen

- Die Claim-/Evidence-Basis wird unter dem Case-Lock erneut berechnet.
  Geaenderte Belege nach der API-Vorabpruefung verhindern die Review-Genehmigung.
- Eine Genehmigung verlangt einen verarbeiteten Snapshot und eine bestandene,
  eindeutige aktuelle Validierung, die dessen gespeicherten Quellhash benennt.
  Der Hashvergleich belegt keine externe Echtheit oder fachliche Bedeutung.
- Die real konfigurierte Review-Struktur und alle Pflichtkriterien werden
  geprueft. Eine SHARE-Sperre auf den Konfigurationstabellen verhindert auch
  das Einfuegen eines weiteren Pflichtkriteriums waehrend derselben Review-Transaktion.
- Ein identischer Review-RPC kann das bereits vollstaendig gespeicherte Review
  wiederverwenden. Ein konkurrierender gegenteiliger Abschluss auf derselben
  Validierungsbasis wird abgelehnt. Die API kann einen bereits abgeschlossenen
  Review weiterhin vor dem RPC als Konflikt melden.
- Wiederholter Widerruf erzeugt keinen zweiten Widerruf. Ein zweiter aktiver
  Claim fuer denselben Candidate wird unter dem Case-Lock abgelehnt.
- Die Claim-Payload-Pruefsumme wird fuer neue Claims aus der serverseitig
  abgeleiteten JSONB-Darstellung erzeugt. Alte Claims werden nicht neu gehasht.
  Der Hash ist keine fachliche Bestaetigung.

## Nachweise

Die Originaldatenbank wurde ausschliesslich lesend abgefragt. Die verwendeten
Spalten, Defaults, Review-Constraints und Triggerdefinitionen stehen in
`2026-10-26-review-schema-observations.json` und
`2026-10-26-claim-write-schema-observations.json`.

`atomic-review.test.mjs` prueft auf PGlite die neue Migration gemeinsam mit
dem Historien-Schutz aus PR #56 und den beobachteten bestehenden Review-/Claim-Triggern.
27 gezielte SQL-Tests bestanden beim lokalen Entwicklungsnachweis, u.a.:

- Erzwungener Fehler beim Schreiben jedes einzelnen Review-Bestandteils:
  keine zuvor geschriebenen Review-Zeilen bleiben bestehen.
- Fehler in Claim, Beleg, Freigabehistorie, Log oder Audit: Claim, Belege und
  Sicherheitswiderruf rollen gemeinsam zurueck.
- Bei gescheitertem kanonischem Historien-Audit bleibt kein Widerruf bestehen.
- Positivfall, Wiederholung, fehlende Rechte, Snapshot-/Validierungswechsel,
  geaenderter Quellhash, offene Candidates, unbewiesene Bedeutung, fehlende
  Pflichtkriterien und nicht-boolsche Eingaben.
- Die vorgeschlagenen Claims bleiben `UNPROVEN`; es werden keine neue
  Validierung, keine semantische Genehmigung und kein Zertifikat erzeugt.

Die API-Tests pruefen die Weitergabe der echten Actor-/Snapshot-Identitaet,
die Nutzung genau eines mutierenden RPC, 503 bei fehlender Migration und
Fehlerantworten ohne scheinbar erfolgreich gespeicherten Trace.

## Echte PostgreSQL-Parallelitaet

Der Workflow `atomic-decision-postgres.yml` stellt einen kurzlebigen lokalen
PostgreSQL-17.6-Service im GitHub-Runner bereit. Er verwendet keine Supabase-
Zugangsdaten. Das Skript akzeptiert ausschliesslich eine lokale Datenbank
namens `petraplan_test`. Die voneinander unabhaengigen Verbindungen pruefen:

1. Zwei gleiche Review-Anfragen: ein Abschluss, eine Wiederverwendung.
2. Zwei gegensaetzliche Review-Anfragen: zweiter Abschluss blockiert.
3. Entzug der Reviewer-Rolle waehrend des Wartens: blockiert nach dem Lock.
4. Neuere Validierung waehrend des Wartens: alte Anfrage blockiert.
5. Geaenderte Evidence waehrend des Wartens: alter Fingerprint blockiert.
6. Neues Pflichtkriterium: Konfigurationsaenderung wartet bis zum Review-Commit.
7. Rollback eines Widerrufs: wartender Widerruf erzeugt genau einen vollstaendigen Abschluss.
8. Zwei Claim-Anlagen fuer denselben Candidate: ein Claim und ein Belegsatz.

Der Test wartet auf einen nachgewiesenen PostgreSQL-Lock in `pg_stat_activity`,
nicht auf eine angenommene Ausfuehrungsreihenfolge. Der aktuelle native
Pruefstatus wird im PR dokumentiert; das Vorhandensein des Workflows ist
fuer sich noch kein bestandener Parallelitaetsnachweis.

Das Fixture verwendet die beobachteten Spalten/Defaults und Review-/Claim-
Constraints und Trigger; angrenzende Tabellen enthalten nur die fuer den
Entscheidungspfad erforderlichen Schluessel. Es ist kein vollstaendiger
Nachbau aller Supabase-Policies, Extensions, Auth- und PostgREST-Ablaufe.

## Verbleibende Grenze

Die unabhaengige Quellen-/Digest-Verifikation und fachliche Bedeutungspruefung
samt aktueller Domain-Autoritaet bleiben separate offene Arbeit. Eine technische
Reviewer-Rolle und ein gespeicherter technischer Claim bestaetigen keine Bedeutung.
Die Kandidaten-Revalidierung bleibt gesperrt. Vollstaendiger Schema-/Migrationsabgleich,
Snapshot-Lebenszyklus und authentifizierter Browser-/API-/Datenbanktest bleiben offen.

Die neue Migration wurde nicht produktiv angewandt. Weder PR #56 noch dieser
Arbeitsschritt wurden gemergt oder produktiv deployt. Der unbekannte
Gesamtdatensatz bleibt hinter dem Abschluss der bekannten Restpunkte.

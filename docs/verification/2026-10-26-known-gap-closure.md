# Bekannte Luecken schliessen: Arbeitsnachweis vom 26.10.2026

Ziel bleibt: bekannte offene Punkte der gesamten Bruecke schliessen, dann den
festgehaltenen Stand mit einem unabhaengigen unbekannten Datensatz pruefen.
Ein gruener Einzeltest, ein existierender Branch und eine vorhandene Tabelle
sind jeweils begrenzte Nachweise. Der unbekannte Datensatz wurde noch nicht ausgefuehrt.

## Gepruefte Ausgangsbasis

- `main`: `0af057c90652019a70279b90d496376087cc9188`.
- PR #52: `26f7261e15fe676f8520c6ebe1ff58606cda668b`.
- Vorhandene Integration von #52/#53/#54:
  `0ca0121ffd0ca922d740efaf3163a7ada6cbd328`.
- Die Integration enthielt `certificateAuthority.ts`, benutzte diese Auswahl
  aber noch nicht in `caseTrace.ts`, der produktiven `caseList.ts` oder den
  Sicherheitsabgleich-Funktionen. Die Regressionstests aus #53/#54 fehlten.
- Originaldatenbank `yxhllviostywckxoehgf`: nur Katalog-, Struktur- und
  Berechtigungs-Leseabfragen; keine produktiven Daten veraendert.

## Umgesetzt und lokal nachgewiesen

| Offener Punkt | Ergebnis und Grenze |
| --- | --- |
| Beliebige Zertifikatswahl bei Zeitgleichstand | Gemeinsame Auswahl in beiden Falllisten, Detailansicht, Sicherheitsabgleich, Claim-Invalidierung und manueller Entscheidung. Mehrdeutigkeit sperrt die Verwendung. |
| Beliebige Auswahl einer Freigabehistorie | Zeitgleichstaende und ungueltige Zeitangaben sperren. Ein spaeterer historischer `trusted`-Eintrag kann eine vorherige terminale Entscheidung nicht verdecken. |
| Unterschied zwischen Datenbankzeit und JavaScript-Zeit | Gemeinsamer Zeitvergleich bewahrt Nachkommastellen bis Nanosekunden. PostgreSQL-Mikrosekunden werden nicht auf Millisekunden zusammengezogen. Zeitzonen werden als Zeitpunkte verglichen. |
| Fehlende oder mehrdeutige Validierungsbasis | Keine Ersatzfreigabe aus einem beliebigen positiven Test. Eine fehlende Zertifikatsreferenz, unzeitbare Beobachtung oder mehrdeutige neue positive Validierung liefert keine positive Autoritaet. |
| Unvollstaendige Abfrageergebnisse | Entscheidungsrelevante Listen fordern die exakte Anzahl an. Ein gekuerztes Ergebnis fuehrt zu einem expliziten Fehler statt zu einer scheinbar vollstaendigen Bewertung. |
| Terminaler Status bei fehlender/neuer semantischer Basis | `releaseGate` bewahrt `revoked` und `superseded`, bevor es eine heutige Grundlage bewertet. Eine Ausnahme reaktiviert das Zertifikat nicht. |
| Freigabehistorie nachtraeglich veraenderbar | Neue Entwicklungs-Migration verhindert UPDATE/DELETE/TRUNCATE, terminale Reaktivierung und clientseitige Erfindung von Zeit/Vergaengerstatus. Ein Eintrag und sein kanonischer Audit-Eintrag sind eine Datenbanktransaktion. **Nur isoliert getestet, nicht produktiv angewandt.** |

Die API gibt Mehrdeutigkeit als Sperrgrund an und verhindert positive
Review-/Freigabeentscheidungen sowie die Auswahl eines willkuerlichen Zertifikats
zum manuellen Widerruf. Eine technische Review-Berechtigung wird dadurch nicht
zu fachlicher Autoritaet.

## Korrekturen gegenueber der PDF-Baseline

Die aktuellen Originaldefinitionen sind in
`2026-10-26-original-schema-observations.json` dokumentiert.

- Address, Address-Beobachtung und Impact-Link besitzen bereits
  Append-only- und INSERT-Audit-Trigger. Parent-Adressen muessen zur gleichen
  Quelle gehoeren. Diese Funktionen wurden zusaetzlich in einem isolierten,
  relevanten Teilschema ausgefuehrt und mit positiven/negativen Faellen geprueft.
- Die Originaldatenbank erlaubt bei `impact_links` derzeit ausschliesslich
  `impacts`. Die PDF-Aufzaehlung von `derives_from`, `conflicts_with` und
  `replaces` beschreibt keine aktuell erlaubten Werte. Die Richtung bleibt
  Candidate -> Address; der Link ist keine fachliche Bestaetigung.
- Fuer `release_status_history` wurden **keine nicht-internen Trigger**
  gefunden. Genau hier setzt die neue, noch nicht angewandte Migration an.
- Die Migrationshistorie enthaelt bereits `semantic_rule_governance` und
  `claim_check_requirements` vom 06.10. unter den Versionen
  `20261006145123` und `20261006145130`. Diese unterscheiden sich von den
  Dateinamen des Entwurfs. Ein blindes Anwenden der gesamten Entwurfshistorie
  waere daher falsch. Der Fall-Release-Guard vom 19.10. ist nicht nachgewiesen
  installiert und sein Trigger wurde beim Katalogabgleich nicht gefunden.
- Originalbestand bei der Lesepruefung: 32 Adressen, 36 Impact-Links, 2 Claims.
  Unter `SET LOCAL ROLE authenticated` und `anon` lieferten die drei Tabellen
  jeweils 0 sichtbare Zeilen. Das prueft die Datenbankrollen, keine echte
  angemeldete Browser-/JWT-Sitzung und keine Browser-Schreibrechte.
- Im aktuellen Bestand wurden keine Zertifikats- oder Historien-Zeitgleichstaende
  gefunden. Das ist keine Garantie fuer zukuenftige Einfuegungen.

## Snapshot-Fragen konkretisiert

- `source_hash` im Ingest-Code ist SHA-256 ueber `JSON.stringify(sourcePayload)`.
  Das ist eine konkret bezeichnete Serialisierung, kein kanonischer JSON-Hash
  und kein Nachweis der Echtheit einer externen Quelle.
- `processed` wird nach dem technischen Erfassen und dem Anlegen der
  technischen Validierung gesetzt. Es bedeutet weder fachliche Bestaetigung
  noch Freigabe. Bei einem spaeteren Erfassungsfehler wird der begonnene
  Snapshot als `error` behandelt.
- Der beobachtete Snapshot-Trigger schuetzt Rohinhalt, Quellhash, Quellsystem
  und Quellreferenz gegen UPDATE. Metadaten und Prozessstatus bleiben aenderbar.
  Ein Loesch-/Archivierungsvertrag bleibt offen; kein neuer wurde erfunden.

## Noch offen: Voraussetzungen vor dem unbekannten Gesamtdurchlauf

| Bereich | Konkreter Restpunkt |
| --- | --- |
| Claim / Evidence | Vertrauenskonfigurierte Quellenabfrage, echter Digest-Abgleich, authentifizierter unveraenderlicher Verifikationsbeleg und unabhaengige fachliche Bedeutungspruefung implementieren und an die konkrete Validierung binden. Deklarierte `VERIFIED`-Metadaten reichen nicht. |
| Authority | Aktuelle Grants, Widerruf und Ablauf beim tatsaechlichen Konsum pruefen; technische Rolle und fachlichen Geltungsbereich getrennt halten. |
| Datenbankintegration | Bereits installierte Definitionen gegen Entwurfsmigrationen vollstaendig abgleichen; neue Aenderungen in einer passenden nichtproduktiven PostgreSQL-Umgebung inklusive konkurrierender Verbindungen testen. PGlite beweist diese Parallelitaet nicht. |
| Review / Audit | Mehrteilige Review-Schreibvorgaenge und die zusaetzlichen Log-/Decision-Audit-Schreibvorgaenge der Sicherheitsfunktionen sind noch keine gemeinsame RPC-Transaktion. Der neue kanonische Historien-Audit-Trigger ersetzt diesen fehlenden Gesamtnachweis nicht. |
| Mobil / Auth | Echte authentifizierte Browser-/API-/Datenbankkette mit den vorgesehenen Rollen pruefen. Typecheck/Build und Rollen-SQL ersetzen das nicht. |
| Snapshot / Lebenszyklus | Metadaten-Revisionsvertrag, Snapshot-Zeit-/Identitaetsschutz, Loeschung/Archivierung und Ownership abschliessend festlegen und pruefen. |

Der positive Kandidaten-Revalidierungsendpunkt bleibt gesperrt. Eine Regelgenehmigung
erzeugt weiterhin keine fachliche Claim-Bestaetigung, Validierung oder Freigabe.
Die Bruecke ist mit diesem Arbeitsstand **noch nicht vollstaendig abgenommen**.

## Reproduktion

```sh
npm test
npm run test:decision-integrity
npm --prefix frontend/mobile-app run typecheck
npm --prefix frontend/mobile-app run build
```

Die neuen Tests aus #53/#54 wurden mit realistischeren Abfrage-Doubles
(Filter, LIMIT, Schreibverbot) uebernommen und erweitert. Auf der unveraenderten
Integrationsbasis schlugen 12 von 35 ausgefuehrten Gegenbeispielen fehl. Diese
Gegenprobe betraf die vorhandenen Luecken; weitere neue Tests kamen anschliessend
hinzu. Aktuell bestanden: 167 Backendtests, 113 kompilierte Entscheidungspruefungen,
69 vorhandene isolierte SQL-Tests, 4 neue Historien-Integritaetstests,
3 Tests der beobachteten Snapshot-/Address-/Reference-Schutzfunktionen und
217 mobile Bridge-Tests. Mobile Typecheck und Build bestanden; der Build meldet
weiterhin die bestehende Warnung zu einem JavaScript-Buendel ueber 500 kB.

SQL-Nachweise verwenden PGlite und ein relevantes Teilschema, einschliesslich
der per Katalog gelesenen echten Audit-/Address-/Snapshot-Funktionsdefinitionen.
Sie sind keine vollstaendige Kopie der Originaldatenbank. Kein Merge,
keine produktive Migration und kein Deployment wurden ausgefuehrt.

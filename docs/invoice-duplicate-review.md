# Fallübergreifender Rechnungsvergleich – lesender Pilot

Stand: 28.11.2026. Implementierungsbasis: Integration `bf3f9f2` (PR #64).
Der weclapp-Nachweis in PR #65 ist ein unabhängiger Review-Stand und wird hier
nicht erneut geöffnet. Northwind/27 bleibt im verfügbaren Datenumfang abgeschlossen.

## Verhalten und Beleggrenzen

Zwei Rechnungen unter verschiedenen Fall-IDs können dieselbe Rechnung abbilden.
Der neue Vergleich liefert dafür **Verdachtshinweise**, auch bei abweichender
Rechnungsnummer. Er bestätigt keine wirtschaftliche Identität, schreibt keine
Entscheidung und blockiert keine Freigabe. Eine Fachentscheidung mit Belegbezug
und ein atomarer Freigabeschutz bei verändertem Vergleichsbestand fehlen weiterhin.

| Hinweis | Erforderliche Beobachtung | Grenze |
|---|---|---|
| Gleiche XML-Originalbytes | Gleicher berechneter SHA-256 in zwei aktuellen, beleggebundenen Fällen | Andere PDF-Bytes werden gesondert angezeigt; wirtschaftliche Dublette unbewiesen. |
| Gleiche erklärte Rechnungsidentität | Technisch akzeptierte XML, gemeinsame Lieferanten- und Empfängerkennungen, gleiche Nummer und gleiches Rechnungsjahr sowie gleiche Rechnungsart | Änderungen an Datum, Betrag, Währung oder Inhalt werden markiert. Kennungen sind Dokumentangaben. |
| Ähnliche Rechnung bei anderer Nummer | Akzeptierte XML, gemeinsame Parteienkennungen, gleiches Datum, Währung, exakter Dezimalbetrag und Digest der erfassten Positions-/Leistungsmerkmale | Keine vollständige semantische Rechnungsprüfung. Weitere fachliche Belege erforderlich. |
| Ähnliche Inhalte mit schwachen Parteien | Dasselbe Inhalts-/Datums-/Betragstupel und exakte normalisierte Lieferanten- und Empfängernamen | Fehlende belastbare gemeinsame Kennungen bleiben als unvollständige Grundlage sichtbar. |

Widersprechende Kennungen derselben Art verhindern die namensbasierte
Ausweichsuche. Name und Betrag allein reichen nicht. Andere Rechnungsart,
Währung, Empfänger oder erfasste Leistungs-/Positionsmerkmale erzeugen keinen
Inhaltsverdacht. Dieselbe Nummer mit denselben Parteien im selben Jahr kann
dagegen ausdrücklich einen Identitätsverdacht trotz solcher Änderungen erzeugen.

Die Extraktion unterstützt den bisherigen UBL-/CII-Vertrag und ergänzt ein eigenes
`invoice-duplicate-signals-v1`-Objekt. Erfasst werden deklarierte VAT-/explizit
schematisierte Organisationskennungen samt XML-Pfad, Nummer, Datum, Rechnungsart,
Zahlbetrag/Währung sowie ein kanonischer Digest aus Positionsbezeichnung, Menge,
Einheit, Nettobetrag, Steuerkategorie/-satz, erfassten Perioden, Kopfzuschlägen und
-abzügen, Lieferdatum und Bestellreferenz. Nicht erfasste fachliche Merkmale sind
kein Beweis ihrer Gleichheit. Beträge werden ohne Gleitkomma verglichen;
Nummern bleiben undurchsichtige Zeichenfolgen ("0001" ist nicht "1").

## Bindung, Rechte und Begrenzung

Die SQL-Funktionen lesen nur die jeweils aktuelle `records.ingestion_log_id` und
Originale/KoSIT-Bericht samt zugehöriger ursprünglicher Validierung. Berechnete
Hashes müssen mit den gespeicherten Belegverweisen übereinstimmen. Historische
Revisionen werden nicht als zusätzliche Fälle gezählt. `STABLE` gibt eine
Beobachtung innerhalb des aufrufenden Statements, keinen Schutz bis zur späteren
Freigabe. Nach Änderungen am Bestand muss aktualisiert werden.

Maximal 200 andere Fälle (deterministisch nach Fall-ID) und 50 Hinweise werden
zurückgegeben. Abgeschnittene Ergebnisse, fehlende Belege und unvollständige
Signale werden kenntlich gemacht. "Keine Treffer in den unterstützten Vergleichen"
ist kein Nachweis von Dublettenfreiheit. Alte Fälle ohne Zusatzsignale können nur
auf identische XML-Bytes geprüft werden und bleiben sonst unvollständig.

Nur `service_role` darf die RPCs ausführen. `GET /api/cases/:id/invoice-duplicates`
braucht die angemeldete Person mit `can_review`, eine aktuelle Snapshot-ID und den
serverseitigen Schalter `PETRAPLAN_INVOICE_DUPLICATE_SCOPE=single-project-pilot`.
Ohne Schalter bleibt der Endpunkt deaktiviert. Rollen sind projektweit: **keine
Mandantentrennung**. Der Vergleich darf nur im ausdrücklich vorgesehenen
Einzelprojekt-Piloten aktiviert werden. Browserantworten sind `private, no-store`.
Fehler, veraltete Fassungen und unbrauchbare Antworten werden nicht zu einer
leeren Erfolgsliste umgedeutet. Die UI verwirft verspätete Antworten alter Fassungen.

## Bestehende Fälle und nächste Abnahme

Die zusätzlichen Signale verändern die relevante Prüfgrundlage eines erneut
importierten älteren Originals. Der bestehende Import kann deshalb eine explizite
Revision mit den vorhandenen atomaren Widerrufsregeln erzeugen. Es findet weder
ein automatisches Backfill noch eine Umschreibung alter Nachweise statt.

Lokale Nachweise stehen unter `docs/verification/2026-11-28-invoice-duplicates/`.
Vor gehosteter Abnahme zusätzlich das [Runbook](invoice-hosted-test-runbook.md)
ausführen: echte Anmeldung, tatsächlich angewandte SQL-Definitionen, Rollen und
Projektumfang sind durch PGlite/Testidentitäten nicht bewiesen. Die Freigabe bleibt
bis zu einer späteren verbindlichen Integration unabhängig vom Dublettenhinweis.

# Rechnungsweg · lokale Abnahme

Stand vom 17. November 2026. Geprüfter Implementierungsstand ist Commit `aba0b60fb61143ecfcb2bcba19aa6bbfb1cb174a` mit Git-Tree `c0e4241affc573698e366aa65b61399ca854d4a4`.

Die folgenden Ja-Angaben gelten für die bezeichneten lokalen Testfälle. Die App-Proben verwendeten eine Testsitzung und lokale API-/Datenbankadapter. Der KoSIT-Worker lief als eigener Prozessdienst über HTTP auf dem lokalen Rechner. Die ursprüngliche Datenbankprobe war ein isoliertes PGlite-Teilschema mit den übernommenen PetraPlan-Funktionen und ausgewählten beobachteten Constraints und Triggern. Zusätzlich wurden die unten genannten Rechnungsrennen auf PostgreSQL 17 mit getrennten Verbindungen geprüft. Eine gehostete Abnahme ist offen.

## Checkliste

| Nr. | Kriterium | Lokal abgenommen | Konkreter Nachweis |
|---|---|---|---|
| 1 | Upload nimmt UBL, CII und ZUGFeRD an. | **Ja** | Originale UBL- und CII-XML sowie die ZUGFeRD-PDF-Proben werden vom Upload-Handler geprüft und im Fall gespeichert. Die ZUGFeRD-Probe mit sichtbarer Betragsabweichung ist gespeichert und bleibt blockiert. |
| 2 | Die Datei landet im richtigen Fall, auch als geänderte Fassung. | **Ja** | Revision benötigt den aktuellen Snapshot. Fall-ID wird explizit übergeben. Unpassender Fall und abweichende Rechnungsnummer ergeben HTTP 409. Zwei unterschiedliche Uploads auf derselben Ausgangsfassung ergeben einmal HTTP 201 und einmal HTTP 409. |
| 3 | KoSIT-Bericht und Original sind per Prüfsumme verbunden. | **Ja** | Bericht prüft SHA-256 der XML-Originalbytes. Bei ZUGFeRD ist die XML der eingebettete CII-Anhang. Original-PDF, PDF-Prüfsumme und Bericht werden zusätzlich gemeinsam gespeichert. Gegenprobe mit fremdem XML oder Bericht wird abgewiesen. |
| 4 | Hinweis oder Abweichung erzwingt eine bewusste Bearbeitung vor Freigabe. | **Ja** | 7-%-Fall mit BR-DE-TMP-32 verlangt einen Belegverweis im ausdrücklichen Review. Bei eindeutigem passendem OCR-Treffer verlangt das PDF-Review Download des Originals, Sichtbestätigung aller Seiten und getrennte Eingabe von Betrag und Währung. Eine erkannte PDF-Abweichung oder Mehrdeutigkeit bleibt gesperrt. |
| 5 | Freigabe folgt auf ausdrückliches Review durch einen berechtigten Akteur. | **Ja** | Vor Review existiert kein Zertifikat. Fehlende PDF-Bestätigung, falsche Währung, falscher Sichtbetrag und falsche PDF-Prüfsumme scheitern. Das erfolgreiche Review erzeugt noch keine Freigabe. Erst der separate Freigabeaufruf erstellt ein Zertifikat. Bestehende SQL-Gegenproben prüfen Review- und Freigaberechte. |
| 6 | Eine neue gespeicherte Grundlage sperrt und widerruft die alte Freigabe atomar. | **Ja** | Änderung des Zahlbetrags erzeugt fehlgeschlagene Validierung und Widerruf in derselben Transaktion. Fehlendes Widerrufsrecht führt zur vollständigen Rückabwicklung der Revision. Auch geänderte PDF-Bytes widerrufen die Freigabe und erfordern neues Review. |
| 7 | Ergebnis, Original und zugehörige Belege sind abrufbar. | **Ja** | Fallprojektion bindet die aktuellen und früheren Prüfergebnisse an ihre Validierungen. Browser bei 390 px zeigt Zahlbetrag, KoSIT-Meldungen, XML-Fundstelle, Freigabe und Widerruf. Die Historie öffnet den damaligen Prüfbeleg. Der PDF-Endpunkt liefert die Originalbytes und prüft den Fallbezug und die Prüfsumme. |

Bei Punkt 4 bedeutet bewusste Bearbeitung, dass ein Hinweis dokumentiert geklärt wird oder der Fall wegen einer Abweichung gesperrt bleibt. Das aktuelle Verfahren erlaubt eine positive PDF-Sichtbestätigung nur bei eindeutig passendem OCR-Treffer und bestandener XML-Prüfung. Ein [Textentwurf zum Ausnahmeprozess](invoice-pdf-exception-draft.md) liegt vor. Die Umsetzung für abweichende oder unlesbare PDFs ist offen.

## Vier Abnahmefälle

| Abnahmefall | Lokal abgenommen | Beleg im Repository |
|---|---|---|
| 7-%-Hinweis durch die Review-Kette | **Ja** | `tests/decision-integrity/invoice-case.test.mjs` prüft das Scheitern ohne Leistungszeitraum-Beleg und den anschließenden Review-/Freigabeweg. Der lokale Browserlauf führte Upload, Belegeingabe, Review und Freigabe aus. |
| CII und ZUGFeRD mit abweichendem PDF-Betrag | **Ja** | Derselbe Test prüft CII-Upload und ZUGFeRD mit 530,87 im PDF gegenüber 529,87 in CII. Die Abweichung bleibt blockiert. |
| Zwei Fassungen gleichzeitig | **Ja** | Zwei konkurrierende Handler-Aufrufe mit demselben erwarteten Snapshot ergeben eine gespeicherte Revision und einen Konflikt. Der zusätzliche Test mit getrennten PostgreSQL-17-Verbindungen steht in `tests/postgres/invoice-case-concurrency.test.mjs`. Unterschiedliche Revisionen, identische Wiederholung und Rollback mit wartender Revision sind im CI erfolgreich geprüft. |
| Zuordnung zum Rechnungsfall | **Ja** | Fall-ID, erwarteter Snapshot, Rechnungsnummer und gespeicherte Verkäuferbezeichnung werden geprüft. Die Testfälle decken den korrekten Bezug sowie unpassenden Fall und abweichende Nummer ab. |

## OCR-Lücken

| Befund | Lokale Anforderung erfüllt | Verhalten und verbleibende Reichweite |
|---|---|---|
| Zusätzlicher Betrag außerhalb des früheren Bildausschnitts | **Ja** | Ganzseiten-OCR fand im konkreten Gegenbeispiel beide Zahlbetragszeilen. Das Ergebnis ist mehrdeutig und blockiert. |
| Fehlerhaft oder unlesbar erkanntes Zeichen bzw. Betrag | **Ja, als Freigabesicherung** | Ein OCR-Treffer allein erteilt keine Freigabe. Positive Sichtbestätigung verlangt das Original, einen unabhängig eingegebenen Betrag, die Währung und die passenden PDF-/XML-Prüfsummen. Unlesbare und mehrdeutige Ergebnisse bleiben blockiert. Die allgemeine OCR-Erkennungsgenauigkeit ist damit nicht nachgewiesen. |

Die positive PDF-Probe wurde kontrolliert erzeugt. Sie enthält einen von KoSIT akzeptierten CII-Anhang und einen sichtbaren Zahlbetrag von 336,90 EUR. Die Probe belegt den Sichtbestätigungsweg und keine vollständige ZUGFeRD- oder PDF/A-Konformität. Die abweichende ZUGFeRD-Probe stammt aus dem vorhandenen öffentlichen Muster und wurde gezielt geändert.

## Nachweise und Wiederholung

- `tests/decision-integrity/invoice-case.test.mjs` enthält Upload, Fallzuordnung, Review, Freigabe, Revision, atomaren Widerruf, positive PDF-Sichtbestätigung und zugehörige Gegenproben.
- `tests/decision-integrity/invoice-worker.test.mjs` prüft Worker-Authentifizierung sowie Dateibindung.
- `tests/decision-integrity/atomic-review.test.mjs` und `database.test.mjs` enthalten die allgemeinen Rechte- und Freigabeprüfungen.
- Mit allen lokalen KoSIT- und PDF-Testvariablen liefen die drei Rechnungs- und zwei Worker-Tests erfolgreich. Es gab fünf bestandene Tests, null Fehler und null übersprungene Tests.
- Die Browser-Proben waren lokale Abnahmeläufe mit Testsitzung. Sie sind bisher nicht als portabler Browser-Test in GitHub CI hinterlegt.
- [PetraPlan CI](https://github.com/schieskejulia-collab/petraplan/actions/runs/44089316202) und [PostgreSQL 17](https://github.com/schieskejulia-collab/petraplan/actions/runs/44089316203) waren am genannten Commit erfolgreich. Die ursprüngliche PostgreSQL-Prüfung betrifft die allgemeine Entscheidungskette. Der zusätzliche [PostgreSQL-17-Lauf](https://github.com/schieskejulia-collab/petraplan/actions/runs/44170253810) am Commit `001ea338bdc0fbca98f54c1028ed5f39d890d04c` enthält drei Rechnungsrennen mit getrennten Verbindungen. Insgesamt bestanden 19 Tests bei null Fehlern und null übersprungenen Tests. Die Rechnungsrennen verwenden synthetische Worker-Artefakte und prüfen gezielt die Datenbanktransaktion. Sie belegen keinen weiteren KoSIT- oder Browserlauf.

Testdateien, Umgebungsvariablen und Aufrufe stehen in [invoice-contract.md](invoice-contract.md).

## Gehostete Abnahme

| Kriterium | Gehostet abgenommen |
|---|---|
| Worker-Container gebaut und gestartet | **Nein** |
| Migrationen auf einem abgeglichenen gehosteten Testschema installiert | **Nein** |
| Upload über App mit echtem Supabase-Login | **Nein** |
| Sieben Schritte gemeinsam in dieser Umgebung durchlaufen | **Nein** |

Damit ist der bezeichnete lokale Rechnungsweg abgenommen. Die gehostete Abnahme bleibt ein eigener Nachweis. Allgemeine ERP-Summenregeln werden erst nach diesem Rechnungsweg umgesetzt. Die fachliche Vorarbeit steht in [erp-quantity-aggregation-rule.md](erp-quantity-aggregation-rule.md).

## Rechte und weitere offene Punkte

Uploader, Reviewer und Freigeber dürfen heute dieselbe Person sein, wenn die jeweilige aktive Bridge-Rolle die nötigen Rechte trägt. Das Vier-Augen-Prinzip wird im normalen Rechnungsweg nicht erzwungen. Die genaue Rechtezuordnung und die offenen Punkte Doppelrechnungen, PDF-Ausnahme sowie weclapp-Cent stehen in [invoice-open-items.md](invoice-open-items.md).

## Eingefrorener Stand und spätere Erweiterung

Die bisherige lokale Abnahme ist [unverändert eingefroren](verification/2026-11-17-invoice-local-baseline.md). Die danach entwickelte [PDF-Ausnahme](invoice-pdf-exception-implementation.md) hat eigene Nachweise; sie ändert den damaligen Prüfumfang nicht rückwirkend. Der normale Weg erzwingt weiterhin keine Funktionstrennung. Diese bekannte Grenze muss gegenüber Kunden offengelegt werden.

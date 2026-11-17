# Fremddatentest 03 · vorab festgelegter Prüfplan

Datum: 17. November 2026. Dieser Plan und expected.json werden vor dem ersten Brückenlauf committed. Danach werden Erwartungen und Produktregeln für den ersten Lauf nicht geändert. Beobachtungen, Abweichungen und Ergebnisse erhalten einen nachfolgenden Commit. Der Test verwendet keine produktiven Kundendaten.

## Eingefrorener Stand

Produktcommit `129fa9a04cceff800f6f251ccb304785a45459aa`, Tree `c53e95d1696c708e18bb7ab86cc93b00b6a30a70`. GitHub meldet zum zuvor lokal geprüften Implementierungsstand einen leeren Dateivergleich. Der lokale Index liefert denselben Tree. `freeze.json` bindet Laufzeitquellen, SQL-Migrationen, Validator-JAR, dessen vollständige lokale Konfiguration, Quellenliste und Erwartungsdatei per SHA-256.

## Auswahl ohne Brückenergebnisse

Sechs unveränderte XML-Rechnungen der KoSIT-Testsuite: je UBL und CII für 01.14 (abweichender Zahlungsempfänger), 02.03 (Zahlbetrag null, Vorauszahlung und zweite Steuerwährung), 03.01 (negativer Zahlbetrag und 14 Positionen). Die Auswahl beruht auf der Beschreibung in `src/doc/test-overview.md`, nicht auf dem Verhalten der Brücke.

Zwei unveränderte ConnectingEurope-Beispiele: eine HUF-CII-Rechnung mit allgemeinem EN16931-Profil und eine UBL-CreditNote. Zusätzlich ein unverändertes französisches Factur-X-PDF aus akretion/factur-x, mit eingebettetem CII und zusätzlichem Lieferschein-Anhang. Quellencommits, Downloadpfade und Dateihashes stehen in sources.json.

Die neun Originaldateien haben keinen exakten SHA-256-Treffer im inventarisierten bisherigen lokalen XML-/PDF-Korpus. Ausgeschlossen wurden insbesondere 01.01 bis 01.08, 01.20, 03.03 und 03.06 sowie die bisherigen PDF-Proben. Das beweist lokale Nichtverwendung der Bytes; es beweist keine weltweite Unabhängigkeit oder repräsentative Stichprobe. KoSIT-Regeln und KoSIT-Beispiele stammen zudem aus derselben Standardfamilie. Deshalb sind weitere Herausgeber enthalten.

## Vorab-Erwartungen

| Gruppe | Erwartung vor der Brücke |
|---|---|
| Sechs KoSIT-Rechnungen | Als Rechnungsfall speichern, technische Prüfung bestehen und READY_FOR_REVIEW erreichen. Keine automatische Freigabe. Die fachlich beobachteten Beträge sind 12829.69, 0 und -225.14 EUR. |
| HUF-CII mit allgemeinem EN16931-Profil | Struktur/Felder lesen; mit der eingefrorenen reinen XRechnung-Konfiguration keine positive technische Freigabegrundlage erwarten. Bei Ablehnung speichern und gesperrt halten. Das ist keine Aussage, dass die Rechnung allgemein ungültig sei. |
| UBL-CreditNote | Der deklarierte aktuelle Rechnungsvertrag unterstützt diesen Wurzeltyp nicht: Import ablehnen, keinen scheinbar geprüften Fall und kein Zertifikat erzeugen. |
| Französisches Factur-X-PDF | Eingebettetes XML und PDF getrennt erhalten. Allgemeines EN16931-Profil ergibt mit der XRechnung-Konfiguration keine positive technische Grundlage. Der sichtbare Zahlbetrag NET A PAYER 104,90 EUR entspricht BT-115 104.90; ein OCR-Stopp darf nicht als nachgewiesene Betragsabweichung ausgegeben werden. |

Die Werte in expected.json wurden direkt aus den Originalen gelesen, ohne Aufruf des Produktlesers oder KoSIT. Dabei wurde das französische PDF separat als Seite gerendert und sein sichtbarer Zahlbetrag geprüft. Die Vorab-Tabelle enthält Erwartungen, keine Ergebnisse.

## Ausführung und Bewertung

Der Lauf benutzt den echten Upload-Handler, separaten lokalen HTTP-Worker, KoSIT und die vorhandenen SQL-RPCs in einem isolierten PGlite-Teilschema. Anmeldung und Supabase-Abfragen werden durch lokale Testadapter ersetzt. Der vollständige gehostete Betrieb und echte fachliche Zeichnungsberechtigung werden nicht behauptet.

Für jede Eingabe: Hash vor Upload prüfen; Ergebnis, Vertragsfelder, Positionszahl und Quellen-/Berichtsbindung gegen die Vorab-Werte prüfen; Fallprojektion aufrufen; nach Upload darf kein Zertifikat existieren. Bei READY_FOR_REVIEW werden Review und Freigabe als ausdrücklich protokollierte Testhandlungen mit Testberechtigungen ausgeführt. Bei BLOCKED wird ein Reviewversuch ausgeführt: er darf keine Freigabegrundlage erzeugen. Wo keine Ausnahmegrundlage besteht, darf auch ein Ausnahmeantrag keinen Durchlass schaffen.

Zusätzlich wird eine unveränderte Eingabe wiederholt und eine andere Originalsyntax derselben Rechnung als Revision eingesetzt, falls Nummer und Verkäufer übereinstimmen. Wiederholung darf kein Duplikat erzeugen; neue Originalbytes müssen die bisherige Freigabe atomar widerrufen und neues Review erfordern.

Ergebnisse werden getrennt als korrekt erkannt, berechtigter Stopp, unerwartete Einschränkung oder nachgewiesene Prüflücke ausgewiesen. Ein gesperrter Eingang belegt nur den erreichten Schutz; nachgelagerte Prüfungen gelten damit nicht als getestet. Keine Reparatur oder Lockerung der Produktregeln während dieses Laufs. Ein Fehler im Testadapter wird separat dokumentiert und erlaubt keine rückwirkende Änderung der Erwartungen.

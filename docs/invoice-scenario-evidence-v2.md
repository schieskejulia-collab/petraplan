# KoSIT-Prüfbelegvertrag v2 und PDF-Zahlbetrag

Arbeitsstand 27.11.2026. Diese Änderung folgt auf den unveränderten Erstbefund
in PR #63. Sie ist eine neue Implementierungsversion; die Erwartungen und
Ergebnisse des eingefrorenen Erstlaufs werden nicht rückwirkend geändert.

## Problem und neues Verhalten

Der bisherige Leser verlangte immer `val-sch.2`. Damit blockierte die Brücke
zwei von KoSIT akzeptierte allgemeine EN16931-CII-Rechnungen. Gleichzeitig
bezeichnete die Oberfläche die eigene Sperre als fehlgeschlagene KoSIT-Prüfung.

`kosit-scenario-evidence-v2` prüft den konkreten Szenariovertrag. Eine allgemeine
EN16931-Rechnung benötigt XML-Parsing, XSD und EN16931-Schematron. Ein
XRechnung-Szenario benötigt zusätzlich das XRechnung-Schematron. Eine positive
KoSIT-Entscheidung allein ersetzt keinen vollständigen passenden Prüfbeleg.

| Profilfamilie | Explizite Profilkennung | Erforderliche Schritte |
|---|---|---|
| EN16931 | `urn:cen.eu:en16931:2017` | val-xml, val-xsd, val-sch.1 |
| XRechnung | EN16931 + `#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` | zusätzlich val-sch.2 |
| XRechnung Extension | XRechnung + `#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0` | zusätzlich val-sch.2 |
| XRechnung CVD | XRechnung + `#compliant#urn:xeinkauf.de:kosit:xrechnung:cvd_0.9` | zusätzlich val-sch.2 |

Die Tabelle gilt für UBL Invoice und CII, nicht UBL CreditNote. Unbekannte
Profilkennungen werden nicht allein wegen eines ähnlich benannten Szenarios
übernommen. CVD-/Extension-Verträge besitzen hier konstruierte Leserprüfungen;
daraus folgt keine Abnahme realer CVD-/Extension-Rechnungsfälle.

## Bindung und Sperren

- Original-XML und Bericht bleiben über den SHA-256 verbunden.
- Syntax und Profil kommen aus der gelesenen Original-XML.
- Der erwartete Szenarioname wird aus dieser expliziten Zuordnung bestimmt.
- Genau eine passende Definition muss in der administrativ konfigurierten
  lokalen `scenarios.xml` und genau ein Szenario im Bericht vorliegen.
- Die vollständigen Szenariodefinitionen werden strukturell verglichen;
  Formatierungsleerraum und XML-Namensraumpräfixe ändern die Identität nicht.
- Zahl und Pfade der konfigurierten XSD-/Schematron-Ressourcen müssen dem
  expliziten Vertrag entsprechen. Die berichteten Ressourcen müssen zu den
  lokalen Definitionen passen.
- Fehlende, zusätzliche oder doppelte Schritte, unklare Ergebnisse, falsche
  Ressourcen, negative Schritte und unerlaubte Meldungsstufen bleiben sperrend.
- Ohne vertrauenswürdige lokale Konfiguration gibt es keine positive
  Vertragsprüfung. Eine Bezeichnung oder ein Hash-Text allein reicht nicht.

Der konfigurierte Worker, seine lokale Validatorinstallation, Konfiguration
und Regelressourcen bleiben administrative Vertrauensanker. Die Änderung ist
keine kryptographische Authentifizierung eines beliebigen fremden Berichts.
Ein Szenariofingerabdruck ergänzt die bereits gespeicherten JAR-, Szenario-
und Ressourcenprüfsummen. Der Feldauslesevertrag bleibt `en16931-invoice-v1`;
der separate Prüfbelegvertrag ist versioniert.

Die Fallprojektion unterscheidet `validatorDecision`, `accepted`,
`reportContractStatus` und unerwarteten Ausführungsfehler. Eine eigene
Prüfbelegsperre wird nicht als KoSIT-Ablehnung angezeigt. Historischen Belegen
ohne gespeicherte Validatorentscheidung wird keine Entscheidung erfunden.

## PDF-Sichtbetrag

Die Ganzseiten-OCR erkennt die vollständigen Beschriftungen `Zahlbetrag`,
`amount due`, `NET A PAYER` und `NET À PAYER`, auch wenn OCR sie in mehrere
Wörter zerlegt. Ein alleinstehendes `due` genügt nicht mehr. Die Zahl muss
rechts auf derselben geometrischen Zeile zugeordnet sein. Mehrere Kandidaten
bleiben mehrdeutig; ein unlesbarer oder nicht zugeordneter Betrag bleibt offen.
Getrennte Tausendergruppen sowie Null und Vorzeichen werden erhalten.

Das französische Original aus PR #63 erreicht mit sichtbaren 104,90 EUR nun
`NEEDS_VISUAL_CONFIRMATION`. Es erhält keine automatische Freigabe. Download,
Sichtung aller Seiten, unabhängig eingegebener Betrag und Währung, Review
und separate Freigabe bleiben erforderlich. Die bestehenden Grenzen für
Seitenanzahl, Rendergröße und unterstützte eingebettete XML gelten weiter.

## Wiederholung und Nachweise

`tests/invoice-resources.json` pinnt die offizielle JAR 1.6.3, das offizielle
Konfigurationsarchiv v2026-08-31, dessen 97 Dateien, 13 öffentliche XML-/PDF-
Eingaben sowie zwei originale Peppol-R051-Ressourcen. Der Download-Helfer
prüft alle Hashes und benötigt keine Zugangsdaten.

```sh
python3 scripts/verification/prepare-invoice-resources.py .invoice-test-resources
python3 scripts/verification/create-invoice-pdf-fixtures.py .invoice-test-resources/inputs
export PETRAPLAN_KOSIT_JAR="$PWD/.invoice-test-resources/validator.jar"
export PETRAPLAN_KOSIT_SCENARIOS="$PWD/.invoice-test-resources/config/scenarios.xml"
export PETRAPLAN_INVOICE_FIXTURES="$PWD/.invoice-test-resources/inputs"
export PETRAPLAN_PDF_POSITIVE="$PETRAPLAN_INVOICE_FIXTURES/positive.pdf"
export PETRAPLAN_PEPPOL_R051_DIR="$PWD/.invoice-test-resources/peppol"
npm ci
npm ci --prefix frontend/mobile-app
npm test
npm run test:decision-integrity
python3 -m unittest backend.tests.test_invoice backend.tests.test_invoice_pdf backend.tests.test_kosit_contract -v
npm run typecheck --prefix frontend/mobile-app
npm run build --prefix frontend/mobile-app
python3 tests/browser/test_invoice_flow.py
```

Python benötigt PyMuPDF, lxml und Playwright; Java und Tesseract mit `eng`
müssen installiert sein. Der Browseraufruf nutzt Playwright-Chromium oder
einen über `PETRAPLAN_CHROMIUM_PATH` ausdrücklich angegebenen kompatiblen
Browser. Die vollständige isolierte Einrichtung, Browserregression und
Containerprobe stehen in `.github/workflows/invoice-local-verification.yml`.

Die Browserregression führt echte lokale HTTP-Handler, separaten KoSIT-/OCR-
Worker, SQL-RPCs und PGlite aus. Anmeldung und Supabase-Abfragetransport sind
explizite Testadapter. Eine zusätzliche Diagnoseanzeige wird als reine
Darstellungsprobe geprüft. Das ist keine gehostete oder fachliche Abnahme.

Neue Prüfmetadaten verändern die gespeicherte Entscheidungsgrundlage. Ein
erneuter Import einer bereits freigegebenen alten Fassung kann daher einen
neuen Snapshot und Widerruf erfordern. Alte Originale und Belege bleiben
unverändert; Bestandsfälle werden nicht per Backfill umgeschrieben.

## Weiterhin getrennt

Gehosteter Login, vollständiger Schemaabgleich, tatsächliche fachliche
Befugnisse, weclapp-Cent, Dubletten und allgemeine positive Bedeutungsprüfung
bleiben eigene Nachweise. Der Northwind-/27er-Fall ist im verfügbaren
Testdatenumfang abgeschlossen und wird durch diese Änderung nicht geöffnet.

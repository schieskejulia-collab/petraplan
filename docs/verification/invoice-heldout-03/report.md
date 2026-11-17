# Fremddatentest 03 · Ergebnis des eingefrorenen Rechnungswegs

Durchgeführt am 17. November 2026. **Sechs neue XML-Rechnungen erreichen nach gesondertem Testreview und ausdrücklicher Testfreigabe den Status freigegeben. Zwei allgemeine EN16931-Beispiele stoppen an einem zu engen Prüfbelegfilter. Eine Gutschrift wird als nicht unterstützter Dokumenttyp abgewiesen.** In diesen neun Eingaben wurde kein unberechtigter Durchlass beobachtet. Das ist keine allgemeine Sicherheits- oder Konformitätszusage.

## Was vor dem Lauf feststand

Der Produktstand ist Commit `129fa9a04cceff800f6f251ccb304785a45459aa`, Tree `c53e95d1696c708e18bb7ab86cc93b00b6a30a70`. [Plan](protocol.md), [Erwartungen](expected.json), [Quellen](sources.json) und [Regelmanifest](freeze.json) wurden im separaten Commit `ef85fda962cbde5006c01cea882cca115e363429` festgeschrieben, bevor der Produktlauf startete. Alle 181 im Manifest erfassten Laufzeit-/Migrationsdateien, die Validator-JAR und 97 Konfigurationsdateien sind vor und nach dem Lauf hashgleich. Auch die vorab gespeicherten Erwartungen und Quellen blieben unverändert.

Die neun Originale wurden aus gepinnten Commits von drei Herausgebern geladen. Ihre Bytes haben keine exakten SHA-256-Treffer im zuvor inventarisierten lokalen XML-/PDF-Korpus. Die Stichprobe wurde nach beschriebenen Eigenschaften gewählt; sie ist weder zufällig noch statistisch repräsentativ. Nichtverwendung außerhalb des inventarisierten Arbeitsstands kann damit nicht bewiesen werden. Die KoSIT-Proben und der Validator teilen die zugrunde liegende Standardfamilie.

## Ergebnisse

| Eingabe | Zahlbetrag laut XML | Tatsächliches Ergebnis | Einordnung |
|---|---:|---|---|
| KoSIT 01.14 · UBL und CII | jeweils 12829.69 EUR | Upload, Fall, KoSIT, Testreview, ausdrückliche Freigabe und abrufbare Belege erfolgreich | Korrekt erkannt; abweichender Zahlungsempfänger separat erhalten |
| KoSIT 02.03 · UBL und CII | jeweils 0 EUR | Derselbe Weg erfolgreich; null bleibt null | Korrekt erkannt; Vorauszahlung/Brutto werden nicht als Zahlbetrag eingesetzt |
| KoSIT 03.01 · UBL und CII | jeweils -225.14 EUR | Derselbe Weg erfolgreich; Vorzeichen erhalten | Korrekt erkannt; keine Umdeutung in einen positiven Zahlbetrag |
| ConnectingEurope · HUF-CII | 87859.00 HUF | Gespeichert, KoSIT akzeptiert, Bridge blockiert, Review und Ausnahmeantrag verweigert | Unerwartet zu enger Prüfbelegfilter; keine Ablehnung durch KoSIT |
| ConnectingEurope · UBL-CreditNote | außerhalb des aktuellen Vertrags | HTTP 422; kein neuer Fall und kein Zertifikat | Berechtigter Stopp am nicht unterstützten Wurzeltyp; nachgelagerte Prüfungen nicht erreicht |
| akretion · französisches Factur-X-PDF | 104.90 EUR | Original/PDF/XML/Beleg gespeichert; KoSIT akzeptiert XML; Bridge blockiert; OCR liefert NOT_COMPARABLE | Zu enger Prüfbelegfilter plus Sprach-/Layoutgrenze beim Sichtbetrag |

Acht Eingaben werden als Rechnungsfälle gespeichert. Für diese stimmen 72 ausgewählte Termvergleiche und insgesamt 42 Positionen mit den vorab aus Originalen gelesenen Erwartungen überein. Die 109 im Laufprotokoll erfassten Einzelbedingungen sind erfüllt; keine Termabweichung wurde gefunden. **Diese Zählung ist keine vollständige fachliche Rechnungsprüfung.** Die Ursachenanalyse unten zeigt insbesondere eine falsche Vorab-Annahme trotz formal erfüllter Stopperwartung.

Nach keinem Upload existiert automatisch ein Freigabezertifikat. Für die sechs technisch akzeptierten KoSIT-Eingaben wurden Review und Freigabe als getrennte, protokollierte Testhandlungen mit Testberechtigungen ausgeführt. Dies ist keine reale fachliche Zeichnung oder Zahlungsfreigabe. Die zwei blockierten Rechnungen konnten weder per normalem Review noch per ungeeignetem PDF-Ausnahmeantrag durchgelassen werden. Die CreditNote erzeugte keinen scheinbar geprüften Fall.

## Nachgewiesener Befund F03-01: Prüfbelegfilter blockiert akzeptiertes EN16931

Die Vorab-Erwartung BLOCKED für die allgemeinen EN16931-Beispiele traf ein. **Ihre Vorab-Begründung war falsch:** Die vorhandene Konfiguration ist nicht ausschließlich auf XRechnung beschränkt. Sie enthält ein allgemeines Szenario `EN16931 (CII)` und KoSIT hat beide Dokumente dort akzeptiert.

| Beleg | XRechnung-Proben | HUF-CII und französisches eingebettetes CII |
|---|---|---|
| KoSIT-Entscheidung | accept | accept |
| Enthaltene gültige Schritte | val-xml, val-xsd, val-sch.1, val-sch.2 | val-xml, val-xsd, val-sch.1 |
| Eigener Bridge-Status technicalEvidence.accepted | true | false |
| Auswirkung | READY_FOR_REVIEW | KOSIT_NOT_ACCEPTED |

Der unveränderte Leser `backend/ingestion/invoice.py`, Funktion `read_kosit_report`, verlangt für jede Syntax pauschal auch `val-sch.2`. Dieser zusätzliche Schritt gehört zu den XRechnung-Szenarien; im allgemeinen EN16931-Szenario ist er nicht vorhanden. Eine unabhängige direkte KoSIT-Nachprüfung beider Original-XML lieferte zusätzlich jeweils Exit-Code 0. Die ersten Berichte des Produktlaufs bleiben unverändert archiviert.

Das ist eine nachgewiesene funktionale Einschränkung und eine ungenaue Ursachenzuordnung: Die Brücke stoppt; der Fehler liegt nicht in einer negativen KoSIT-Entscheidung. Eine Oberfläche, die daraus „KoSIT-Prüfung fehlgeschlagen“ macht, vermittelt den falschen Grund. Im ersten Lauf wird der Filter nicht gelockert. Für eine nachfolgende Regelversion muss zuerst der zulässige Umfang jedes Szenarios ausdrücklich festgelegt und dessen vollständiger positiver Beleg geprüft werden. Einfach einen Pflichtschritt zu entfernen wäre kein ausreichender Nachweis.

## Befund F03-02: französischer Sichtbetrag wird nicht verglichen

Im gerenderten Original steht eindeutig `NET A PAYER 104,90 EUR`; der eingebettete Wert ist `104.90`. Die eingefrorene OCR-Auswertung sucht die Bezeichnungen „Zahlbetrag“ und „amount due“. Für das französische Dokument ergibt sich `NOT_COMPARABLE`, leere Kandidatenliste. Die Fallansicht zeigt einen nicht eindeutig lesbaren Sichtbetrag und behauptet keine beobachtete Betragsdifferenz. Der technische Code `PDF_VISUAL_AMOUNT_CONFLICT` ist hierfür gröber als der genauer gespeicherte Befund.

Das ist eine reproduzierte Erkennungsgrenze für dieses französische Layout. Eine Betragsgleichheit wird nicht automatisch behauptet, und die Sperre bleibt bestehen. Wegen F03-01 konnte der positive Ausnahmeweg an diesem Original nicht erreicht werden. Dieser Test ersetzt deshalb nicht den getrennten Vier-Augen-Nachweis der vorherigen Implementierungsabnahme.

## Wiederholung und Revision

Die unveränderte 01.14-UBL-Datei wurde erneut in denselben Fall geladen: HTTP 200, wiederverwendeter Snapshot, kein neuer Rechnungsstand. Danach wurde die unveränderte CII-Darstellung derselben Rechnung als neue Fassung eingesetzt: HTTP 201, neuer Snapshot und neue Validierung, Widerruf des alten Zertifikats in derselben Transaktion. Beide Fassungen bleiben in der Fallhistorie erhalten; für die neue Fassung ist ein neues Review erforderlich.

## Ansicht und Reichweite

Fünf zusätzliche mobile Darstellungsproben bei 390 px zeigten die reale lokale Fallprojektion für null, negativen Betrag, HUF, französisches PDF und den Widerruf nach Revision. Keine JavaScript-Seitenfehler und kein horizontaler Überlauf wurden beobachtet. Diese Proben verwenden aufgezeichnete lokale Traces und eine Testsitzung; sie sind ein Darstellungsnachweis. Der vorausgehende Importlauf benutzt den echten Upload-Handler, separaten HTTP-Worker, KoSIT, OCR und SQL-RPCs in einem isolierten PGlite-Teilschema. Supabase-Abfragen und Anmeldung verwenden Testadapter.

Offen bleiben echter gehosteter Login, vollständiges Supabase-Schema, Containerbau und gehostete Worker-Ausführung. Es wurden keine neuen Rennen mit diesen Fremddaten auf PostgreSQL ausgeführt; die vorherigen PostgreSQL-Rennnachweise bleiben gesondert. Ebenso nicht nachgewiesen sind beliebige PDF-Erkennung, alle EN16931-Felder, automatische Dublettenerkennung, allgemeine ERP-Semantik oder sichere Weiterverarbeitung durch jedes externe Zielsystem.

## Belege und Wiederholung

- [Maschinenlesbares Ergebnis](results.json): jede Eingabe, HTTP-Ergebnis, Bedingungen, Testreview, Testfreigabe, Diagnose und mobile Proben.
- [Dateimanifest](evidence-files.json) und [komprimierte Original-Laufbelege](evidence.tar.gz): erste KoSIT-Berichte und kompakte Fall-Traces vor/nach Entscheidung. Die kompakten Traces behalten Fall-, Validierungs-, Review-, Freigabe- und Rechnungsbelege; wiederholte rohe Ingestion-Payloads sind ausgelassen. SHA-256 bezieht sich auf die unkomprimierten Dateien im Archiv.
- Ausführung: `scripts/verification/invoice-heldout-03.mjs`; Darstellungsprobe: `scripts/verification/invoice-heldout-03-browser.mjs`.
- Die Eingaben können über sources.json aus den gepinnten URLs geladen werden; vor Nutzung sind ihre SHA-256 zu prüfen. Der Lauf benötigt dieselbe Validator-JAR und Konfiguration aus freeze.json sowie Python, Java, PyMuPDF, Tesseract und die bestehenden Node-Abhängigkeiten. Der gespeicherte Produktstand bleibt unverändert.

**Nächste getrennte Arbeit:** szenariobezogenen Prüfbelegvertrag festlegen, danach F03-01 in einer neuen Version beheben und mit Positiv-/Negativbelegen erneut prüfen. Die Ergebnisse und Erwartungen dieses ersten Laufs werden dabei nicht nachträglich umgeschrieben. Der 27er-ERP-Fall bleibt anschließend ein eigener Strang.

### Reproduktionsaufruf

Vom Repository-Stamm aus `npm ci` und `npm run build` ausführen. Die neun Dateien aus sources.json unter ihren dortigen `filename`-Namen in ein separates Eingabeverzeichnis herunterladen. Der Runner prüft die Dateien gegen die vorab gespeicherten Hashes und bricht bei veränderten Produktquellen, Erwartungen oder Validatorressourcen ab.

```bash
export PETRAPLAN_HELDOUT_INPUTS=/pfad/zu/den/neun/originalen
export PETRAPLAN_HELDOUT_OUTPUT=/pfad/zu/neuen/laufbelegen
export PETRAPLAN_KOSIT_JAR=/pfad/validator-1.6.3-standalone.jar
export PETRAPLAN_KOSIT_SCENARIOS=/pfad/config/scenarios.xml
node --experimental-strip-types scripts/verification/invoice-heldout-03.mjs
```

Der Runner ist ein Beobachtungslauf: Bedingungen und Abweichungen werden vollständig in `run.json` protokolliert. Sein Prozessende allein ist kein Grün-Nachweis; `checks`, `termMismatches`, `harnessError`, `revisionProbe` und die tatsächlichen Validatorentscheidungen müssen gemeinsam ausgewertet werden. Die Ursachenanalyse F03-01 lässt sich insbesondere nicht durch die Zahl erfüllter Erwartungen ersetzen.

Für die optionale mobile Darstellungsprobe werden Playwright Core und eine kompatible Chromium-Laufzeit separat bereitgestellt. `PETRAPLAN_PLAYWRIGHT_MODULE` und `PETRAPLAN_CHROMIUM_MODULE` zeigen auf deren importierbare Module. Nach `npm run build --prefix frontend/mobile-app` liest `node scripts/verification/invoice-heldout-03-browser.mjs` die zuvor gespeicherten Traces; das ist weiterhin kein echter Login-Test.

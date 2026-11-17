# Rechnungsvertrag für UBL und CII

`en16931-invoice-v1` liest eigenständige Rechnungs-XMLs. Der Vertrag umfasst BT‑1, BT‑2, BT‑5, BT‑24, BT‑27, BT‑59, BT‑72, BT‑84, BT‑109, BT‑110, BT‑112 und BT‑115, die Positionsfelder BT‑126, BT‑151 und BT‑152 sowie Abrechnungs- und Positionszeiträume (BG‑14 und BG‑26).

Die JSON-Ausgabe enthält den SHA‑256 der Originaldatei, XML-Fundstellen mit Namensraum und Index, beobachtete Werte und Attribute, Zuordnungen zum Rechnungsvertrag sowie fehlende oder mehrdeutige Felder. Geldbeträge bleiben Dezimaltexte. Datumswerte behalten ihre ursprüngliche Schreibweise und erhalten zusätzlich ein ISO-Datum. Die Zahl der Beobachtungen hängt von der konkreten Datei ab. Felder außerhalb des Vertrags bleiben als Beobachtungen sichtbar.

## Lokal ausführen

Python 3.12, Java und eine lokal installierte KoSIT-XRechnung-Konfiguration verwenden. Die Pfade für JAR und Konfiguration stammen aus der lokalen Installation. Aus dem Repository-Stamm ausführen.

```sh
python3 -m backend.ingestion.invoice rechnung.xml \
  --kosit-jar /pfad/validator-1.6.3-standalone.jar \
  --scenarios /pfad/xrechnung/scenarios.xml \
  --save-report pruefbeleg.xml
```

`--save-report` ist optional und legt eine neue Datei an. Der Leser bindet den erzeugten Bericht über den darin enthaltenen SHA‑256 an die gelesene XML und dokumentiert Engine, Szenario, Meldungen, Prüfresultate und die Hashes von Bericht sowie lokaler Validator-Konfiguration. Die Ausgabe meldet bei einer erfolgreichen technischen Prüfung `READY_FOR_REVIEW`. Fehlende oder ablehnende Prüfevidenz ergibt `BLOCKED`. BR‑DE‑TMP‑32 bleibt eine Hinweismeldung. Der Rückgabecode ist bei einem blockierten Lauf 1.

Dieser reine Leseaufruf speichert keine Fälle. Der lokale Fallimport weiter unten bindet Rechnungen an die bestehende Entscheidungskette.

## Prüfungen

```sh
python3 -m unittest backend.tests.test_invoice.InvoiceProjectionTest -v
```

Für die zusätzlichen Integrationstests `PETRAPLAN_KOSIT_JAR` und `PETRAPLAN_KOSIT_SCENARIOS` setzen. `PETRAPLAN_INVOICE_FIXTURES` zeigt auf ein Verzeichnis mit den vier Originaldateien aus der [KoSIT-Testsuite](https://github.com/itplr-kosit/xrechnung-testsuite/tree/master/src/test/business-cases/standard).

| Lokaler Testname | Original | Git-Blob |
|---|---|---|
| 01.01a.xml | 01.01a-INVOICE_ubl.xml | `b0dd3fde1224947d6b224bf41c1feb7680c4ad83` |
| 01.02a.xml | 01.02a-INVOICE_ubl.xml | `7ea9bde2e354263c58ffcfb3160c08a46994e1ec` |
| 01.03a.xml | 01.03a-INVOICE_ubl.xml | `7b0ddac64ac315adc214999fcc48f7c379ddde69` |
| 01.01a-uncefact.xml | 01.01a-INVOICE_uncefact.xml | `4ddca14baf40a3e5adcdc7589616a13890fd4820` |

```sh
python3 -m unittest backend.tests.test_invoice -v
```

Der Integrationstest vergleicht die Zuordnung in UBL und CII, prüft die Berichtbindung und testet einen geänderten Zahlbetrag als Negativfall.

## Fall speichern und eine Revision prüfen

Der lokale Fallimport verwendet denselben XML-Leser und startet KoSIT selbst. Er speichert Original-XML, KoSIT-Bericht, Fundstellen und Validierung zusammen. Er braucht die Migration `20261117100000_invoice_case_evidence.sql` auf einer Testdatenbank mit PetraPlan-Schema, einen vertrauenswürdigen lokalen Dienstzugang und die ID eines aktiven Reviewers. Verwende für den ersten Import eine neue Fall-UUID. Für eine Revision gib den aktuellen Snapshot desselben Falls an.

```sh
export PETRAPLAN_INVOICE_DATABASE_URL='postgresql://…@localhost:5432/…'
export PETRAPLAN_KOSIT_JAR=/pfad/validator-1.6.3-standalone.jar
export PETRAPLAN_KOSIT_SCENARIOS=/pfad/xrechnung/scenarios.xml
node scripts/capture-invoice-case.mjs rechnung.xml <fall-uuid> <reviewer-uuid> [bisherige-snapshot-uuid]
```

Das Ergebnis enthält Fall-, Snapshot- und Validierungs-ID für die bestehende Review- und Freigabekette. Der Import selbst stellt kein Zertifikat aus. Ist die Grundlage einer aktiven Freigabe durch eine Revision ersetzt worden, widerruft derselbe Datenbankvorgang die alte Freigabe. Dafür braucht der Akteur auch Widerrufsrechte. Fehlen sie oder ist der aktuelle Snapshot inzwischen weitergerückt, wird kein neuer Stand gespeichert. Ein wiederholter KoSIT-Lauf mit demselben Befund wird wiederverwendet, auch wenn der Zeitstempel im XML-Bericht sich ändert. Ein Abbruch vor Erzeugung eines prüfbaren KoSIT-Berichts wird als Importfehler ausgegeben und erzeugt keine Fallrevision.

Der Datenbanktest läuft gegen ein isoliertes PGlite-Teilschema. Mit den KoSIT-Umgebungsvariablen und den Originaldateien prüft er Freigabe, Widerruf, Rückabwicklung, Wiederholung und erneute Freigabe nach ausdrücklichem Review.

```sh
node --test tests/decision-integrity/invoice-case.test.mjs
```

## Upload und Abnahme

In der Fallliste startet „Rechnung importieren“ einen neuen Fall. In der Rechnungsansicht lädt „Neue Fassung hinzufügen“ eine Revision für genau diesen Fall und den dort angezeigten Snapshot. Der Import vergleicht die vorhandene Rechnungsnummer und den erfassten Verkäufernamen. Zwei unterschiedliche Revisionen auf derselben Ausgangsfassung konkurrieren um denselben Fall. Hat eine Revision den aktuellen Snapshot ersetzt, antwortet die andere mit HTTP 409. Bei einem verlorenen Antwortpaket kann derselbe Import wiederholt werden.

`POST /api/bridge/invoice-upload` verwendet die bestehende Anmeldung, die Review-Berechtigung und den serverseitigen KoSIT-Worker. Beim Hinweis BR-DE-TMP-32 braucht das Review einen konkreten Belegverweis zum Liefer- oder Leistungszeitraum. Der Hinweis bleibt als solcher im KoSIT-Bericht gespeichert. Review und Freigabe beziehen sich jeweils auf die in der Ansicht angezeigte Fassung.

Für lokale PDF-Proben kann `PETRAPLAN_PDF_TEST_UPLOADS=1` in der Testumgebung gesetzt werden. Der Worker benötigt zusätzlich PyMuPDF und Tesseract mit Sprachmodell `eng`. Er behält Original-PDF und eingebettetes CII getrennt und vergleicht den XML-Zahlbetrag mit Kandidaten aus den vollständig gerenderten Seiten. Ein abweichender, unlesbarer oder mehrdeutiger Sichtbetrag bleibt gesperrt. Ein übereinstimmender OCR-Betrag wartet ebenfalls auf Sichtbestätigung. Eine positive PDF-Sichtfreigabe ist noch nicht implementiert. KoSIT beurteilt ausschließlich die eingebettete XML nach dem eingerichteten Szenario. Ein ZUGFeRD-Profil außerhalb dieser Konfiguration kann deshalb eine negative technische XML-Prüfung haben.

Die lokalen API- und Datenbanktests verwenden die vorhandenen KoSIT-Testvariablen. Die optionalen Variablen `PETRAPLAN_PDF_MISMATCH`, `PETRAPLAN_PDF_OUTSIDE_WINDOW` und `PETRAPLAN_PDF_CONTROL` verweisen auf die drei PDF-Proben mit abweichendem Betrag, zusätzlicher Zahlbetragszeile und übereinstimmendem Betrag. Der gehostete Lauf braucht eine bereitgestellte Worker-Laufzeit mit Python, Java und KoSIT sowie den passenden Datenbankstand.

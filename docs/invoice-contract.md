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

Dieser erste Durchstich arbeitet lokal. Er speichert keine Fälle und erteilt keine Freigaben. Für den produktiven Weg muss die vorhandene Fall- und Freigabekette den Rechnungsvertrag und seinen Prüfbeleg übernehmen.

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

# weclapp-Muster RE1001: Cent-Unterschied rechnerisch nachvollzogen

Stand: 28.11.2026. Produktbasis: Integrationsmerge
`bf3f9f2c4121cc717b4d13606ff5a63077c24b91` nach PR #64.
Keine Produktlogik, Betragsfreigabe, SQL-Migration oder Live-Bereitstellung geändert.

## Herkunft und Umfang

Öffentliches Mustang-Muster `library/src/test/resources/MustangBeispiel20221026.pdf`
aus `ZUGFeRD/mustangproject`, gepinnter Commit
`f9678ecef593a970b76cf0622b64825a45f17b8d`:
[Original-PDF](https://github.com/ZUGFeRD/mustangproject/blob/f9678ecef593a970b76cf0622b64825a45f17b8d/library/src/test/resources/MustangBeispiel20221026.pdf).

- PDF SHA-256: `98a694e3eaca6c7e37a85cba73a640977c121c01549e09182836b433d8d53a18`
- Eingebettetes `factur-x.xml` SHA-256:
  `05adb685ec43b1e4c57f97b8b4b73df72cf54e1d7ed77487818e28c97361b986`
- Die XML-Prüfsumme stimmt mit `layout-results.json` im historischen
  Feldvergleich vom 17.11.2026 überein. Derselbe Bericht dokumentiert bereits
  die PDF-Endsumme 963,12 und XML-Bruttosumme 963,11. Eine damalige PDF-Prüfsumme
  ist in diesem Anhang nicht enthalten; eine byte-identische historische
  PDF-Fassung wird deshalb nicht zusätzlich behauptet.
- Der Befund gilt für dieses konkrete Muster, nicht pauschal für weclapp.

## Originale Angaben und Rechnung

PDF-Seite 1 wurde gerendert und visuell geprüft. Die ausgelesenen Beträge sind
mit Textfundstellen und Wortkoordinaten in `results.json` festgehalten.

| Größe | PDF | XML |
|---|---:|---:|
| Positionen netto / LineTotalAmount | 804,35 | 804,35 |
| Versandkosten / ChargeTotalAmount | 4,99 | 4,99 |
| Gemeinsame Nettobasis | rechnerisch 809,34 | TaxBasisTotalAmount 809,34 |
| Positionsblock-USt. 19 % | 152,83 | keine eigene Header-Steuergruppe |
| Versandkosten-USt. 19 % | 0,95 | keine eigene Header-Steuergruppe |
| Umsatzsteuer gesamt | rechnerisch 153,78 | TaxTotalAmount 153,77 |
| Endsumme / GrandTotalAmount | 963,12 | 963,11 |
| Eigenständiger Zahlbetrag / DuePayableAmount | kein eigenes Label gefunden | 963,11 |
| Anzahlungen / TotalPrepaidAmount | keine eigene Zeile gefunden | 0,00 |
| Expliziter Rundungsbetrag | keine eigene Zeile gefunden | RoundingAmount nicht vorhanden |

Die sichtbaren PDF-Beträge lassen sich mit Dezimalarithmetik und Rundung auf
zwei Nachkommastellen reproduzieren:

```text
round(804,35 × 0,19) = round(152,8265) = 152,83
round(4,99 × 0,19)   = round(0,9481)   =   0,95
PDF-Steuer: 152,83 + 0,95             = 153,78
PDF-Endsumme: 809,34 + 153,78         = 963,12

round((804,35 + 4,99) × 0,19) = round(153,7746) = 153,77
XML-Brutto und Zahlbetrag: 809,34 + 153,77      = 963,11
Differenz                                   =   0,01
```

Das reproduziert den Unterschied vollständig aus den sichtbaren und
strukturierten Angaben. Es belegt die unterschiedliche Rundungsgruppierung
in diesem Dokument. Die interne Implementierung des damaligen PDF-Generators
und eine allgemeine steuerliche oder betriebliche Zulässigkeit werden dadurch
nicht bewiesen.

Die identische Zahlungsbedingung in PDF und XML lautet: innerhalb von 30 Tagen
2 % Skonto, 60 Tage ohne Abzug. Skonto ist eine bedingte Zahlungsangabe und
wurde hier nicht zur Erklärung des Cents angewandt. Ein 2-%-Abzug von 963,11
beträgt gerundet 19,26, nicht 0,01. Die XML enthält weder eine entsprechende
Anzahlung noch einen expliziten Rundungsbetrag zur automatischen Auflösung.

## Ergebnis im unveränderten Produktweg

`scripts/capture-invoice-case.mjs::inspectInvoiceFile` wurde auf der vollständigen
Original-PDF ausgeführt, einschließlich eingebetteter XML, gepinntem KoSIT und
Ganzseiten-OCR:

- KoSIT: `accept`, szenariobezogener Prüfbeleg akzeptiert, EN16931 (CII).
- PDF-Vergleich: `NOT_COMPARABLE`, keine Zahlbetrag-Kandidaten.
- Entscheidung: `BLOCKED`, Blocker `PDF_VISUAL_AMOUNT_CONFLICT`.
- `releaseAllowed` bleibt `false`.

Die XML-Prüfung allein erreicht `READY_FOR_REVIEW`; das ist kein Nachweis für
die vollständige PDF-Strecke. Der integrierte PDF-Weg bleibt gesperrt. Es wurde
kein Antrag auf Ausnahme gestellt, kein Review ausgeführt und keine Freigabe
erteilt. Der ursprüngliche Betrag wird nicht auf 963,11 oder 963,12 korrigiert.

## Dauerhafter Nachweis und Abschlussstatus

`tests/invoice-resources.json` ergänzt genau dieses hashgebundene Muster.
`scripts/verification/check-invoice-weclapp-rounding.py` prüft Quellidentität,
PDF-/XML-Fundstellen, die beiden Rechnungen sowie den unveränderten Produktstopp.
Eine Gegenprobe mit veränderten PDF-Bytes wird vor der Verarbeitung abgewiesen.
Der Prüfer gilt ausdrücklich nur für dieses Muster und ist kein allgemeiner
Rundungs- oder Freigabealgorithmus.

```sh
python scripts/verification/check-invoice-weclapp-rounding.py /path/to/weclapp-rounding.pdf \
  --kosit-jar /path/to/validator.jar --scenarios /path/to/config/scenarios.xml \
  --output /tmp/weclapp-rounding-results.json
```

Lokal bestanden: Original-Gegenprobe mit KoSIT/OCR, geänderte Bytes abgewiesen;
97 Konfigurationsdateien und alle 14 öffentlichen Eingaben per Hash bestätigt.
Die bestehende Rechnungs-CI führt dieselbe Probe aus und sichert die Ergebnisdatei.
Der CI-Lauf wird nach Abschluss separat dokumentiert.

**Untersuchung zum Cent-Unterschied: im Umfang dieses Musters abgeschlossen.**
**Freigabe des widersprüchlichen Dokuments: daraus nicht abgeleitet.** Ein
korrigiertes Original oder eine gesonderte, unabhängig autorisierte und belegte
Ausnahmeentscheidung wäre ein eigener Vorgang. Keine pauschale Cent-Toleranz,
keine Gleichsetzung von Endsumme und Zahlbetrag für beliebige Layouts.

Doppelrechnungen und gehostete Abnahme bleiben offen. Der Schnittstellenwächter
bleibt nachgelagert; der Northwind-/27er-Fall bleibt abgeschlossen.

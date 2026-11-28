# Lokaler Nachweis: lesender Doppelrechnungsverdacht

Stand 28.11.2026; Ausgangscommit `bf3f9f2c4121cc717b4d13606ff5a63077c24b91`.
Produktumfang und verbleibende Grenzen: [Vergleichsvertrag](../../invoice-duplicate-review.md).

Lokal bestanden: **197 Backendtests, 268 Entscheidungs-/Integritätstests, 217
Mobiletests, 25 Pythonprüfungen und 40 Browserbedingungen**, ohne übersprungene
Tests in diesen erfassten Läufen. Backend-/Frontendbuild und Typechecks bestanden.

## Prüfebenen

- Python: UBL/CII-Extraktion, exakte Dezimalbeträge, Originalhash, führende Nullen,
  andere Empfänger, geänderte Mengen/Perioden und fehlende/mehrdeutige Felder.
- Vergleichslogik: identische XML, andere PDF, gleiche Identität mit abweichenden
  Angaben, andere Nummer bei gleichem Inhalt, schwache Parteien, widersprechende
  Kennungen, Gegenproben für Jahr, Art, Währung, Empfänger und Leistung. Geprüft
  werden auch Datenfehler, begrenzte Ergebnismengen und Unverändertheit der Eingabe.
- Tatsächliche SQL-Funktionen in isolierter PGlite-Testgrundlage: aktuelle
  Snapshotbindung, Zugriffsschutz für beide RPCs, Rollen-/Scope-/Limitfehler,
  Revision mit erhaltenem Verlauf, abgeschnittener Bestand, fehlende Belege und
  manipulierte Hashbindung. Ein Vorher-/Nachhervergleich **aller öffentlichen
  Tabellen** bestätigt, dass der lesende Aufruf keine Daten geschrieben hat.
- Tatsächlicher API-Handler: serverseitiger Schalter, authentifizierter Akteur
  statt Request-Angabe, Rechte, Methoden und sichtbare Fehler. Der Frontend-Parser
  weist unvollständige Hinweise und widersprüchliche Abdeckungsangaben zurück.
- Durchgehende Probe mit gepinnter öffentlicher `01.01a.xml`: Original, kontrolliert
  geänderte Rechnungsnummer und zusätzliche Änderung des Leistungszeitraums durch
  KoSIT und Fallimport verarbeitet. Alle drei XML werden technisch akzeptiert.
  Der Nummernfall erzeugt einen **schwachen** Inhaltsverdacht, da gemeinsame
  belastbare Empfängerkennungen fehlen; die andere Periode erzeugt keinen Treffer.
- Browser: 40 Bedingungen mit tatsächlichen Upload-/Vergleichs-/Entscheidungs-
  Handlern, Worker mit KoSIT/OCR und SQL. Mobile Viewport 390 × 844. Enthalten sind
  bestehende Rechnung, Review, separate Freigabe, Revision/Widerruf, unabhängige
  PDF-Ausnahme und jetzt fallübergreifender Kopieverdacht samt unverändertem
  Entscheidungsstand und fehlender Anmeldung als Gegenprobe.

`browser-results.json` hält alle 40 beobachteten Browserbedingungen fest.
`results.json` enthält die beobachteten Summen und Prüfumfänge.

## Wiederholung

Zuerst Node-Abhängigkeiten installieren, Backend und Entscheidungstests kompilieren,
Frontend bauen und die in `tests/invoice-resources.json` gepinnten Ressourcen mit
`scripts/verification/prepare-invoice-resources.py` vorbereiten. Die bestehende
Rechnungs-CI enthält diese Schritte und den Worker-Containerlauf.

```sh
npm test
npm run test:decision-integrity
python -m unittest backend.tests.test_invoice backend.tests.test_invoice_pdf backend.tests.test_kosit_contract backend.tests.test_invoice_duplicate_signals -v
node --test tests/decision-integrity/invoice-duplicates.test.mjs
python tests/browser/test_invoice_flow.py
```

Für die ressourcenabhängigen Prüfungen `PETRAPLAN_KOSIT_JAR`,
`PETRAPLAN_KOSIT_SCENARIOS`, `PETRAPLAN_INVOICE_FIXTURES`,
`PETRAPLAN_PDF_POSITIVE` und `PETRAPLAN_PEPPOL_R051_DIR` auf den lokalen Cache
setzen. Für Browser außerdem Playwright/Chromium bereitstellen. Ohne Ressourcen
übersprungene Tests dürfen nicht als bestanden gezählt werden.

## Aussagegrenze und offener Folgeschritt

SQL-Grundlage und Anmeldung sind lokale Testadapter. Dieser Nachweis behauptet
keine gehostete Supabase-Anmeldung, keine Mandantentrennung und keine neue
PostgreSQL-Verbindungsrennen-Abnahme. Es wurde keine Live-Migration oder
Bereitstellung ausgeführt. Containerbau für diesen Stand ist bis zu einem
entsprechenden erfolgreichen CI-Lauf gesondert offen.

Der Vergleich ist eine lesende Beobachtung, **kein Freigabeschutz**. Eine
verbindliche fachliche Einordnung mit Beleg und deren atomare Bindung an die
Freigabe bleiben separate offene Implementierungsschritte. Ebenso offen bleibt
die gehostete Gesamtabnahme nach Freischaltung der benötigten Umgebung.

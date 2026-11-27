# PDF-Ausnahme im portablen Browserlauf

Fortschreibung vom 27.11.2026 auf dem unveränderten Implementierungsstand aus
PR #64. Diese Erweiterung ändert nur Testadapter, Browserprüfungen und
Nachweisdokumentation; keine Produktlogik und keine SQL-Migration.

## Geprüfte Grenzen

- Zwei gesondert im isolierten Schema angelegte Testidentitäten. Beide besitzen
  technische Ausnahmebefugnisse. Die hochladende/antragstellende Identität wird
  dennoch beim Genehmigen von der echten Datenbankfunktion abgewiesen.
- Kontrolliertes PDF mit 337,90 EUR sichtbarem Zahlbetrag und 336,90 EUR im
  eingebetteten, mit KoSIT akzeptierten CII. Echte Ganzseiten-OCR, gespeicherte
  Originalbytes, hashprüfender PDF-Download und lokale API-Handler.
- Ohne Originaldownload sind Antrag und Genehmigung im Browser gesperrt. Die
  heruntergeladene Datei wird byteweise per SHA-256 mit dem Upload verglichen.
- Die unabhängige Genehmigung erstellt eine eigene Validierung. Die ursprüngliche
  fehlgeschlagene Validierung bleibt erhalten. Weder Antrag noch Genehmigung
  noch Review erzeugen ein Zertifikat. Erst eine gesonderte Freigabe erstellt
  eine als Ausnahme gekennzeichnete, mit der Entscheidung verbundene Freigabe.
- Der Antragsteller erhält nach Genehmigung keine Review-/Freigabebedienelemente;
  auch ein direkter API-Reviewversuch wird abgewiesen.
- Neue PDF-Fassung widerruft die bisherige Ausnahmefreigabe atomar. Alte PDF,
  Ausnahme und Validierung bleiben lesbar; die neue Fassung erbt keine Ausnahme.
- Zwei unterschiedliche sichtbare Zahlbeträge bleiben nicht vergleichbar. Eine
  abgelehnte Ausnahme belässt die fehlgeschlagene Validierung ohne Zertifikat.
- Technisch abgelehntes XML kann keinen PDF-Ausnahmeantrag erhalten.
- Mobile Darstellung mit 390 px ohne horizontalen Überlauf und ohne JS-Seitenfehler.

## Wiederholung und Grenzen

`tests/browser/test_invoice_flow.py` führt diese Schritte zusätzlich zu den
bisherigen 16 Bedingungen aus. Die bestehende Workflowdatei
`.github/workflows/invoice-local-verification.yml` bereitet dieselben gepinnten
Ressourcen vor und führt den erweiterten Browserlauf aus. Lokale Vorbereitung:

```sh
python scripts/verification/create-invoice-pdf-fixtures.py "$PETRAPLAN_INVOICE_FIXTURES"
python tests/browser/test_invoice_flow.py
node --test tests/decision-integrity/invoice-exception.test.mjs
```

Benötigte KoSIT-/Chromium-Pfade und Builds wie im bestehenden Workflow setzen.
Lokal bestehen alle **36 Browserbedingungen** sowie **4 Datenbank-/API-
Ausnahmetests**, jeweils ohne Fehler oder Auslassungen. Ein erster lokaler
Versuch endete an einem falschen Feldnamen im Test (`validation.history` statt
`validation.results`); nach Korrektur besteht der vollständige Lauf. Die
Ergebnisse und Quellprüfsummen stehen in `results.json`. CI ist bei dieser
ersten Veröffentlichung noch ausstehend.

Authentifizierung und Supabase-Abfragetransport sind ausdrücklich Testadapter,
SQL läuft in einem PGlite-Teilschema. Zwei Test-IDs beweisen keine echten Logins
und keine Zuordnung zu unterschiedlichen natürlichen Personen. Dies ist eine
Regression mit bekannten und kontrollierten Daten; kein neuer unabhängiger
Fremddatentest. Keine gehostete Abnahme, Live-Migration oder Projektaktivierung.
Die 21 früheren nativen PostgreSQL-Rennen bleiben separate historische Nachweise.

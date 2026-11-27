# Rechnungsweg: Prüfbelegvertrag v2, 27.11.2026

Die Implementierung korrigiert die zwei dokumentierten Grenzen des Erstlaufs
in PR #63. Die Produktregeln und Ergebnisse des Erstlaufs bleiben unverändert.
Details: `docs/invoice-scenario-evidence-v2.md`.

## Lokale Prüfungen

| Gruppe | Bestanden | Fehler | Übersprungen |
|---|---:|---:|---:|
| Backend | 182 | 0 | 0 |
| Entscheidungsintegrität mit eingerichteten externen Ressourcen | 258 | 0 | 0 |
| Mobile Brückenfunktionen | 217 | 0 | 0 |
| Python-Rechnungs-/Prüfbeleg-/PDF-Prüfungen | 17 | 0 | 0 |
| Browserbedingungen | 16 | 0 | 0 |

Mobile Typprüfung und App-Build bestehen. Die bestehende Bündelgrößenwarnung
bleibt bestehen. Die Browserprobe benutzt echte lokale Handler, getrennten
HTTP-Worker, KoSIT/OCR und SQL-RPCs in einem PGlite-Teilschema; Authentifizierung
und Supabase-Abfrageverkehr sind Testadapter. Die Probe zur Diagnoseanzeige
ist ausdrücklich eine Darstellungsprobe. Keine reale fachliche Zeichnung.

Die kontrollierten PDF-Proben zeigen gleiche, abweichende und doppelte
Zahlbeträge bei byte-identischem eingebettetem XML. Die französische
Originaldatei erreicht Sichtbestätigung; es erfolgt keine automatische Freigabe.

`results.json` hält Testgruppen, Produktprüfsummen und die einzelnen
Browserbedingungen fest. Die gepinnten externen Ressourcen stehen in
`tests/invoice-resources.json`. Die acht archivierten Originalberichte werden
unverändert als Regressionen genutzt. Kein unbekannter neuer Testbestand wird
behauptet: Die bisherigen Fremddaten sind jetzt bekannte Regressionseingaben.

## Getrennte Grenzen

Es wurden keine SQL-Produktmigrationen geändert. Die früheren 21 nativen
PostgreSQL-Rennen sind ein separater Nachweis und wurden hier nicht erneut
behauptet. Container- und GitHub-Läufe werden über ihre konkreten IDs in
`results.json` dokumentiert. Kein gehosteter Login und kein vollständiger
Live-Schemaabgleich. Die read-only Abfrageversuche und gemeldeten inaktiven
Projekte stehen im Runbook; es gab keine Projektaktivierung oder Live-Schreibzugriffe.

Der Northwind-/27er-Fall bleibt im verfügbaren Testdatenumfang abgeschlossen.

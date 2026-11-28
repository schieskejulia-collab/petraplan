# Offene Punkte im Rechnungsweg

Ursprünglicher Stand vom 17. November 2026; fortgeschrieben am 27. November 2026.

Ergänzung 27.11.2026: Der szenariobezogene Prüfbelegfilter und die französische
Zahlbetragserkennung werden im [Prüfbelegvertrag v2](invoice-scenario-evidence-v2.md)
mit eigenen Regressionen korrigiert. Die gehostete Abnahme bleibt separat;
Vorbereitung und Schema-Inventur stehen im [Runbook](invoice-hosted-test-runbook.md).
Der Northwind-/27er-Fall ist im verfügbaren Testdatenumfang abgeschlossen.

| Punkt | Stand | Nächster Nachweis |
|---|---|---|
| Rechnungsrevisionen über getrennte PostgreSQL-Verbindungen | **Lokal/CI abgenommen** | Drei Rennen mit synthetischen Worker-Artefakten im [PostgreSQL-17-Lauf](https://github.com/schieskejulia-collab/petraplan/actions/runs/44170253810) erfolgreich. |
| Ausnahme bei abweichender oder unlesbarer PDF | Lokal und im portablen CI-Browserlauf geprüft | Unabhängige Entscheidung mit expliziter Vollmacht; gehostete Abnahme offen. Siehe [Implementierung](invoice-pdf-exception-implementation.md). |
| weclapp 963,12 im PDF gegenüber 963,11 im XML | Rechenunterschied am gepinnten Muster nachvollzogen | Getrennt gerundete Steuern im PDF ergeben 153,78; die gemeinsame XML-Steuerbasis ergibt 153,77. Kein eigener PDF-Zahlbetrag belegt; der Produktweg bleibt gesperrt. [Nachweis vom 28.11.](verification/2026-11-28-weclapp-rounding/README.md). Keine pauschale Cent-Toleranz. |
| Doppelrechnungen | Offener Folgepunkt | Dublettenverdacht auch bei anderer Nummer prüfen, anhand von Lieferant, Datum, Betrag, Leistungsbezug und weiteren Belegen. |
| Browserprüfung in CI | Normaler Rechnungsweg und PDF-Ausnahme bestanden | [Lauf 46049776473](https://github.com/schieskejulia-collab/petraplan/actions/runs/46049776473): 36 Bedingungen mit zwei Testidentitäten und PGlite; [Nachweis](verification/2026-11-27-invoice-exception-browser/README.md). Kein gehosteter Login-Nachweis. |
| Containerbau und XML-/PDF-Verarbeitung | In CI bestanden | Derselbe Lauf verarbeitet beide Eingabetypen im gebauten KoSIT-/OCR-Worker. |
| Gehosteter Lauf | Offen | Projektverfügbarkeit klären, Worker starten, Migrationsstand abgleichen und sieben Kriterien mit echtem Login prüfen. |

Ergänzung 28.11.2026: Ein optionaler, lesender Vergleich zeigt fallübergreifende Verdachtshinweise auch bei anderer Rechnungsnummer. Er bestätigt keine wirtschaftliche Dublette und sperrt keine Freigabe. Unvollständiger Datenbestand, fehlende Merkmale und Vergleichsgrenzen bleiben sichtbar. Aktivierung ist nur für den ausdrücklich freigeschalteten Einzelprojekt-Piloten vorgesehen; Mandantentrennung ist nicht implementiert. Details und Restumfang stehen im [Vergleichsvertrag](invoice-duplicate-review.md).

## Aktuelle Rechte

Ein Upload braucht eine aktive Bridge-Rolle mit `can_review`. Ein Review braucht `can_review`, eine Freigabe `can_release` und ein manueller Widerruf `can_revoke`. Ersetzt ein Import eine aktive Freigabe, benötigt der importierende Akteur zusätzlich Widerrufsrechte. Fehlen sie, wird die Revision vollständig zurückgerollt.

Dieselbe Person darf heute hochladen, reviewen und freigeben, wenn ihr alle jeweils benötigten Rechte zugewiesen sind. Die Software erzwingt für diesen normalen Rechnungsweg derzeit kein Vier-Augen-Prinzip. Review und Freigabe sind dennoch zwei gesonderte, protokollierte Entscheidungen. Technische Bridge-Rechte belegen keine allgemeine fachliche Zeichnungsberechtigung einer Organisation.

Für PDF-Ausnahmen erzwingt die Datenbank eine zweite ausdrücklich berechtigte Person, die weder hochgeladen noch den Antrag gestellt oder die Fassung zuvor geprüft hat. Danach führt sie Review und Freigabe gesondert aus. Der [Implementierungsnachweis](invoice-pdf-exception-implementation.md) dokumentiert Grenzen und Nachweise.

**Bekannte Grenze für Kunden:** Im normalen Weg ist keine Funktionstrennung erzwungen. Kunden mit entsprechenden internen Kontrollen benötigen eine spätere mandantenspezifische Regelung, bevor dieser Weg dafür eingesetzt wird.

Fortschreibung 28.11.2026: Entscheidungen, Datenbank-Freigabesperre und aktuelle
Anzeige nach Bestandsänderung werden im [Enforcement-Nachweis](invoice-duplicate-enforcement-design.md)
fortgeführt. Der gehostete Test bleibt separat; Zusammenführung ist zurückgestellt.

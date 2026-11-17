# Offene Punkte im Rechnungsweg

Stand vom 17. November 2026.

| Punkt | Stand | Nächster Nachweis |
|---|---|---|
| Rechnungsrevisionen über getrennte PostgreSQL-Verbindungen | **Lokal/CI abgenommen** | Drei Rennen mit synthetischen Worker-Artefakten im [PostgreSQL-17-Lauf](https://github.com/schieskejulia-collab/petraplan/actions/runs/44170253810) erfolgreich. |
| Ausnahme bei abweichender oder unlesbarer PDF | Lokal implementiert und geprüft | Unabhängige Entscheidung mit expliziter Vollmacht; gehostete Abnahme offen. Siehe [Implementierung](invoice-pdf-exception-implementation.md). |
| weclapp 963,12 im PDF gegenüber 963,11 im XML | Ursache offen | Feldarten und Fundstellen für Brutto, Zahlbetrag, Skonto und Rundung abgleichen. |
| Doppelrechnungen | Offener Folgepunkt | Dublettenverdacht auch bei anderer Nummer prüfen, anhand von Lieferant, Datum, Betrag, Leistungsbezug und weiteren Belegen. |
| Browserabnahme in CI | Lokale Proben vorhanden | Portablen Browserlauf mit verfügbaren Testdateien und isolierten Diensten ergänzen. |
| Containerbau und gehosteter Lauf | Offen | Worker starten, Migrationsstand abgleichen und sieben Kriterien mit echtem Login prüfen. |

Doppelrechnungen werden aktuell nicht zuverlässig erkannt. Fallzuordnung und Revisionsschutz sichern den ausgewählten Fall. Zwei neue Fall-IDs können ähnliche oder identische Rechnungen enthalten. Aus gleicher Lieferantenbezeichnung und gleichem Betrag folgt noch keine sichere Dublette. Dieser Punkt wird nach der laufenden Rechnungsabnahme behandelt.

## Aktuelle Rechte

Ein Upload braucht eine aktive Bridge-Rolle mit `can_review`. Ein Review braucht `can_review`, eine Freigabe `can_release` und ein manueller Widerruf `can_revoke`. Ersetzt ein Import eine aktive Freigabe, benötigt der importierende Akteur zusätzlich Widerrufsrechte. Fehlen sie, wird die Revision vollständig zurückgerollt.

Dieselbe Person darf heute hochladen, reviewen und freigeben, wenn ihr alle jeweils benötigten Rechte zugewiesen sind. Die Software erzwingt für diesen normalen Rechnungsweg derzeit kein Vier-Augen-Prinzip. Review und Freigabe sind dennoch zwei gesonderte, protokollierte Entscheidungen. Technische Bridge-Rechte belegen keine allgemeine fachliche Zeichnungsberechtigung einer Organisation.

Für PDF-Ausnahmen erzwingt die Datenbank eine zweite ausdrücklich berechtigte Person, die weder hochgeladen noch den Antrag gestellt oder die Fassung zuvor geprüft hat. Danach führt sie Review und Freigabe gesondert aus. Der [Implementierungsnachweis](invoice-pdf-exception-implementation.md) dokumentiert Grenzen und Nachweise.

**Bekannte Grenze für Kunden:** Im normalen Weg ist keine Funktionstrennung erzwungen. Kunden mit entsprechenden internen Kontrollen benötigen eine spätere mandantenspezifische Regelung, bevor dieser Weg dafür eingesetzt wird.

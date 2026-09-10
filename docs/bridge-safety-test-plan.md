# PetraPlan Bridge – Safety Test Plan

## Ziel

Bevor die Bridge mit echten Unternehmensdaten oder an einer realen Schnittstelle getestet wird, muss sie nachweisen, dass sie lieber blockiert oder eine Bestätigung verlangt, als einen unbestätigten Wert freizugeben.

Grundregel:

> Keine automatische Freigabe bei unbekannter Bedeutung, verletzter Fachregel, Transportfehler oder unbestätigtem Vertrag.

## Safety Gate vor einem externen Pilot

Ein externer Read-only-Test beginnt erst, wenn alle folgenden Punkte erfüllt sind:

1. Alle automatisierten Bridge-Tests sind grün.
2. Source-Werte bleiben in Snapshot/Provenance unverändert erhalten.
3. VALID ist nur möglich, wenn alle blockierenden Constraints erfüllt sind.
4. NEEDS_CONFIRMATION wird bei fehlender Vertrags- oder Bedeutungsbestätigung verwendet.
5. BLOCKED wird bei Transport- oder bestätigten Datenregelverletzungen verwendet.
6. Gemischte Fehler werden nicht zu einem harmloseren Zustand heruntergestuft.
7. Jede Auflösung ist auf einen fehlgeschlagenen Constraint und dessen Evidence zurückführbar.
8. Resolution Steps verändern die Source nicht selbst.
9. Eine Korrektur oder Bestätigung führt immer durch eine vollständige erneute Prüfung.
10. Zustandsübergänge dokumentieren gelöste, verbliebene und neu entstandene Blocker.

## Teststufen

### Stufe 1 – synthetische Safety Matrix

Kontrollierte künstliche Datensätze testen Grenz- und Fehlerfälle. Dazu gehören mindestens:

- gültiger Referenzfall
- fehlende Kundenkennung
- unbekannter Status
- Menge = 0
- negative Menge
- nicht numerische Menge
- ungültiges Datumsformat
- Transport timeout
- Transport failed
- unbekannter Contract
- reine Warning ohne Blocker
- Semantikfehler + Datenfehler gleichzeitig
- mehrere unabhängige Blocker gleichzeitig
- erneute Prüfung ohne Änderung
- Teilauflösung
- vollständige Auflösung
- Regression durch neu hinzukommenden Fehler

### Stufe 2 – erweiterte generierte Fälle

Viele Kombinationen und Grenzwerte werden automatisiert erzeugt. Ziel ist, widersprüchliche Zustände auszuschließen, besonders:

- releaseAllowed=true trotz Blocking Constraint
- state=VALID trotz Blocking Constraint
- verlorener oder mutierter Source-Snapshot
- falsche Priorisierung zwischen NEEDS_CONFIRMATION und BLOCKED
- nicht nachvollziehbare Resolution ohne Evidence

### Stufe 3 – Shadow Test mit realistischen Exporten

Noch keine produktive Schreibverbindung. Die Bridge verarbeitet ausschließlich Kopien/Exports oder gespiegelte Nachrichten read-only. Ergebnisse werden mit einer fachkundigen Person abgeglichen.

Zu jedem False Positive oder False Negative wird dokumentiert:

- Source
- Contract
- Regel
- Evidence
- Bridge-State
- erwarteter fachlicher Zustand
- Ursache der Abweichung
- bestätigte Regeländerung

### Stufe 4 – begrenzter externer Pilot

Nur ein klar abgegrenzter Datenfluss bzw. eine Schnittstelle. Die Bridge bleibt zunächst beobachtend/read-only. Keine automatische Veränderung des produktiven Ursprungssystems.

## Stop-Kriterien

Ein Test oder Pilot wird gestoppt, wenn mindestens eines eintritt:

- falsche Freigabe eines tatsächlich unsicheren Falls
- Verlust oder Mutation von Source-/Provenance-Daten
- nicht erklärbarer Zustandswechsel
- automatische Bedeutungsannahme ohne bestätigte Regel
- Resolution verändert produktive Daten ohne ausdrückliche kontrollierte Freigabe
- Audit-Trail reicht nicht aus, um die Entscheidung nachzuvollziehen

## Erfolgskriterium

Das wichtigste Erfolgskriterium ist nicht, möglichst viele Datensätze als VALID durchzulassen. Das wichtigste Erfolgskriterium ist, unsichere Fälle zuverlässig zu erkennen, nachvollziehbar zu erklären und eine Freigabe zu verhindern, bis die nötige Evidenz oder bestätigte Korrektur vorliegt.

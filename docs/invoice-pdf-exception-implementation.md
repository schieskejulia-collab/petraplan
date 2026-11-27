# Dokumentierte PDF-Ausnahme mit unabhängiger Entscheidung

Stand: 17. November 2026. Der vorherige Rechnungsweg bleibt im [eingefrorenen lokalen Abnahmestand](verification/2026-11-17-invoice-local-baseline.md) festgehalten. Diese Erweiterung hat eigene Nachweise. Keine gehostete Abnahme, keine bereits erteilte betriebliche Ausnahmevollmacht.

Fortschreibung 27.11.2026: Der Browserablauf mit zwei Testidentitäten wird als
portable Regression in die bestehende Rechnungs-CI aufgenommen. Originalabruf,
unabhängige Ausnahmeentscheidung, gesondertes Review, Freigabe und Revision
werden über echte lokale Handler, KoSIT/OCR und SQL-RPCs geprüft. Aktueller
[Laufnachweis](verification/2026-11-27-invoice-exception-browser/README.md).
Die unten aufgeführten Laufzahlen bleiben der historische Stand vom 17.11.
Containerbau und XML-/PDF-Verarbeitung sind inzwischen in
[CI 46046803649](https://github.com/schieskejulia-collab/petraplan/actions/runs/46046803649)
bestanden; die gehostete Abnahme bleibt offen.

## Begrenzter Geltungsbereich

Die Ausnahme gilt nur für eine gespeicherte PDF-Fassung mit technisch akzeptiertem XML und dem einzigen Blocker `PDF_VISUAL_AMOUNT_CONFLICT`. Ein abweichender oder nicht eindeutig lesbarer PDF-Zahlbetrag wird dokumentiert. Technisch abgelehntes XML, weitere Blocker und veraltete Fassungen sind ausgeschlossen. Die XML-/PDF-/Berichtbytes und ihre Prüfsummen werden erneut geprüft.

Die Genehmigung ist eine begrenzte fachliche Entscheidung mit ausdrücklich gespeichertem Verwendungszweck. Sie erklärt die Darstellung nicht nachträglich für übereinstimmend. Der Mechanismus führt keine Zahlung aus und erteilt keine allgemeine Buchungsfreigabe. Eine zulässige Folgehandlung muss die zuständige Organisation festlegen.

## Zuständigkeit und Ablauf

1. Eine Person mit `can_review` stellt einen Antrag für die aktuelle Fassung und Validierung: konkrete Begründung, Belegverweis und erlaubter Verwendungszweck sind Pflicht.
2. Eine andere Person entscheidet. Sie braucht eine aktive Rolle mit `can_review`, `can_release`, `can_approve_invoice_exception` und einen dokumentierten `invoice_exception_authority_reference`. Das zusätzliche Recht ist für bestehende Rollen standardmäßig ausgeschaltet; die Einführung muss es gezielt administrativ zuweisen.
3. Die Datenbank verweigert die Entscheidung, wenn dieselbe Person hochgeladen, den Antrag gestellt oder zuvor diese Fassung geprüft hat. Auch ein ablehnendes früheres Review zählt als Beteiligung. Eine andere Anmeldung allein genügt nicht; maßgeblich ist die gespeicherte Benutzeridentität.
4. Eine Genehmigung erstellt eine neue, mit Originalen und Ausnahmeentscheidung verknüpfte Validierung. Die ursprüngliche fehlgeschlagene Validierung bleibt unverändert. Eine Ablehnung erzeugt keine positive Validierung.
5. Die unabhängige entscheidende Person muss anschließend das Review und danach ausdrücklich die Freigabe ausführen. Beide Schritte prüfen ihre aktuelle Ausnahmeberechtigung erneut. Der Antragsteller kann die genehmigte Ausnahme nicht für eine eigene Freigabe verwenden. Der Hinweis `BR-DE-TMP-32` verlangt weiterhin einen Leistungszeitraum-Beleg.
6. Die API und Fallansicht zeigen das Ergebnis als **Ausnahmefreigabe**, mit Abweichung, Belegen, Entscheidung und Verwendungszweck. Intern bleibt der bestehende Zertifikatsmechanismus erhalten; das Zertifikat enthält zusätzlich die Ausnahme-ID. Verbraucher müssen die geprüfte Fallprojektion verwenden und dürfen aus dem internen Zertifikatsstatus allein keine uneingeschränkte Freigabe ableiten.

Anträge und Entscheidungen sind unveränderliche Historieneinträge. Pro Fassung gibt es einen Antrag und eine abschließende Entscheidung; ein abgelehnter Antrag wird nicht still überschrieben. Eine neue Fassung verlangt einen neuen Antrag. Neue Originalbytes widerrufen eine vorherige aktive Freigabe im bestehenden atomaren Revisionsweg.

Entfällt die Ausnahmeberechtigung oder ändert sich ihr dokumentierter Bezug, blockieren weitere Entscheidungen; die Fallprojektion zeigt die alte Ausnahme nicht mehr als freigabefähig. Ein Rechteentzug schreibt derzeit nicht selbstständig einen neuen Widerrufseintrag in die historische Freigabetabelle. Externe Verbraucher müssen die aktuelle Projektion prüfen.

## Lokale Nachweise

| Prüfung | Nachweis |
|---|---|
| Upload/Antragsteller und vorherige Reviewer dürfen nicht genehmigen | `tests/decision-integrity/invoice-exception.test.mjs`: echte Datenbank-RPCs und API-Handler, isoliertes PGlite-Teilschema |
| Fehlende Ausnahmevollmacht, abgelehntes XML, doppelte Entscheidung und Rechteentzug blockieren | Derselbe Test; keine Ausnahmefreigabe ohne gesondertes Review und Freigabe |
| Originalfehler und Pflicht zum Leistungszeitraum-Beleg bleiben erhalten | Derselbe Test; Änderung/Löschung der Entscheidungshistorie scheitert |
| Revision widerruft aktive Ausnahmefreigabe | Derselbe Test; alte Validierung lässt sich nicht wieder freigeben |
| Mobile Oberfläche bis zur Ausnahmefreigabe | Lokale Browserprobe bei 390 px: kontrolliertes PDF mit 337,90 EUR sichtbar und 336,90 EUR im eingebetteten akzeptierten CII, echte lokale KoSIT-/OCR-Verarbeitung, lokale Handler und PGlite. Zwei Testidentitäten; Testadapter statt echtem Login. Kein unverbrauchter Fremddatenlauf und kein CI-Browsernachweis. |
| Gleichzeitige Ausnahmeentscheidungen / neue Fassung gegen wartende Genehmigung | `tests/postgres/invoice-exception-concurrency.test.mjs`; beide Rennen im [PostgreSQL-17-Lauf 44173127641](https://github.com/schieskejulia-collab/petraplan/actions/runs/44173127641) bestanden. Insgesamt 21 Tests, keine Fehler oder Auslassungen, Implementierungscommit `06676717cffb48e412bd46cb25fe040d97a54012`. |

Backend-Build, mobile Typprüfung und Produktionsbuild sind lokal erfolgreich. Die vier neuen Datenbank-/API-Tests sind lokal grün. Die lokale Entscheidungsregression hat 255 erfolgreiche Tests und drei übersprungene optionale Integrationstests; keine Fehler. Der separate Backend-Testlauf hat 180 erfolgreiche Tests. [PetraPlan CI 44173127587](https://github.com/schieskejulia-collab/petraplan/actions/runs/44173127587) hat API und mobile Prüfungen für Implementierungscommit `06676717cffb48e412bd46cb25fe040d97a54012` bestanden. Die zusätzliche API-Rechteprojektion wird im anschließenden Commit nochmals durch CI geprüft.

## Bekannte Grenzen gegenüber Kunden

Der normale Rechnungsweg erlaubt weiterhin Upload, Review und Freigabe durch dieselbe berechtigte Person. Er bietet derzeit keine erzwungene Funktionstrennung. Das ist vor einem Kundeneinsatz ausdrücklich offenzulegen; eine kundenspezifisch konfigurierbare Funktionstrennung bleibt Folgearbeit. Die PDF-Ausnahme erzwingt bereits die oben beschriebene unabhängige Entscheidung.

Die Identitäten müssen unterschiedlichen Menschen zugeordnet sein; gegen mehrere Konten derselben Person bietet der technische Benutzer-ID-Vergleich allein keinen Nachweis. Dokumentierte Vollmachten und Identitätsverwaltung gehören zur Einführung.

Der weclapp-Unterschied 963,12/963,11 bleibt fachlich ungeklärt. Es gibt keine pauschale Cent-Toleranz und keine automatisch angenommene Erklärung durch Rundung oder XML-Vorrang. Doppelrechnungen und gehosteter Lauf bleiben separat offen.

# Gehostete Rechnungsteststrecke vorbereiten

Diese Checkliste führt keine Migration oder Bereitstellung aus. Lokal
bestandene Prüfungen und ein Containerlauf ersetzen die folgenden Schritte
mit echtem Login und dem tatsächlich bereitgestellten Testschema nicht.

## 1. Code und Datenbank eindeutig festlegen

- Arbeitsbasis ist `integration/truth-chain-52-53-54`, nicht das ältere main.
  Die Korrektur des Prüfbelegvertrags erhält einen eigenen Review-Stand.
- Vor Bereitstellung Commit und Regelstand ausdrücklich festhalten. PR #63
  und seine unveränderten Erstbefunde bleiben separat erhalten.
- Nur die vorgesehene nichtproduktive Datenbank verwenden. Das read-only SQL
  `scripts/verification/invoice-test-schema-preflight.sql` inventarisiert
  Migrationen, RPC-Definitionen, Trigger, Tabellenrechte und RLS-Flags.
- Ergebnisse mit den tatsächlichen Migrationsdateien und Funktionen
  vergleichen. Präsenz oder gleicher Name beweisen keine gleiche Definition.
- Historisch wurden Governance-/Prüfplanmigrationen bereits unter anderen
  Versionsnummern beobachtet. Keine ganze Migrationshistorie blind anwenden.
- Neue Rechnungs-/Ausnahme-RPCs benötigen die vorhandenen Claims-, Review-,
  Autoritäts- und Freigabegrundlagen. Fehlende Funktionen müssen Fehler
  liefern; keine Ausweichschreibrechte für Browserrollen einrichten.

## 2. Getrennten Worker bereitstellen

Die lokale Containerprobe ist über `invoice-local-verification.yml`
wiederholbar. Beispielkonfiguration: `scripts/invoice-worker/.env.example`.

- Node, Python, Java, PyMuPDF, Tesseract `eng`, Validator und gepinnte
  Regelressourcen müssen zur getesteten Installation passen.
- KoSIT-Verzeichnis read-only unter `/opt/kosit` einbinden; es enthält
  `validator.jar` und `config/scenarios.xml` einschließlich Regelressourcen.
- Ein frisch generiertes serverseitiges Worker-Token in Worker und API
  hinterlegen. Es gehört weder in Frontendvariablen noch in Git oder Logs.
- API: `PETRAPLAN_INVOICE_WORKER_URL` und dasselbe
  `PETRAPLAN_INVOICE_WORKER_TOKEN`; außerhalb localhost ausschließlich HTTPS.
- PDF-Upload benötigt in API und Worker `PETRAPLAN_PDF_TEST_UPLOADS=1`,
  ausschließlich in der vorgesehenen Testumgebung.
- Health prüfen, danach eine bekannte kleine XML vollständig verarbeiten.
  Ein erfolgreicher Health-Aufruf allein prüft keine Validator-/OCR-Funktion.
- Requestlaufzeiten und Uploadgrenzen im tatsächlichen Deployment prüfen.
  Die API begrenzt Vercel-Uploads auf 3 MiB; der Worker verarbeitet eine
  Prüfung je Instanz gleichzeitig und meldet bei Belegung 503.

## 3. Echte Anmeldung und Rechte prüfen

- Frontend, API und Datenbank müssen zum richtigen Supabase-Projekt gehören.
  Die stabile Magic-Link-Rücksprungadresse im Frontend mit der tatsächlich
  vorgesehenen Domain und den Auth-Einstellungen abgleichen.
- Mit einem echten Testbenutzer anmelden. Aktive `can_review`, `can_release`
  und für Revision einer freigegebenen Fassung `can_revoke` getrennt prüfen.
- Für Ausnahmen eine zweite unabhängige Person samt dokumentiertem
  Ausnahmebefugnisbezug vorsehen. Keine allgemeine Fachvollmacht aus einer
  technischen Projektrolle ableiten.
- Unangemeldeten Zugriff, fremden Fall, falsche Fassung und fehlende Rechte
  als Negativfälle prüfen. Rollen dürfen sich nicht selbst erweitern.

## 4. Abnahme am selben Fall

1. Kleine Original-XML hochladen: Fall, Originalhash, Bericht und Feldpfad
   abrufen. Noch kein Zertifikat.
2. 7-%-Hinweis BR-DE-TMP-32 ohne Leistungszeitraum-Beleg bleibt ungeklärt.
   Mit passendem Beleg ausdrückliches Review ausführen: weiterhin kein
   Zertifikat. Danach separat freigeben.
3. Dasselbe Original erneut hochladen: nach Maßgabe derselben Prüfversion
   wiederverwenden. Neue relevante Original-/Prüfgrundlage erzeugt eine neue
   Fassung und atomaren Widerruf; beide Fassungen bleiben zugänglich.
4. Zwei Revisionen derselben Ausgangsfassung, Worker-Ausfall und fehlendes
   Widerrufsrecht prüfen. Keine halbe Falländerung oder falsche Freigabe.
5. PDF mit passendem Sichtbetrag, abweichendem Betrag, zwei Zahlbeträgen und
   unlesbarer Angabe prüfen. Sichtbestätigung muss an PDF und XML gebunden sein.
6. Ausnahmeprozess getrennt prüfen: Antragsteller und vorheriger Reviewer
   dürfen nicht genehmigen. Technisch abgelehntes XML darf keine Ausnahme
   erhalten. Originalfehler bleiben historisch sichtbar.
7. Für jeden Fall Commit, Dateihash, Snapshot, Validierung, Akteur, Review,
   Zertifikat und gegebenenfalls Widerruf samt Erwartung/Beobachtung erfassen.

Ungeklärte oder nicht unterstützte Eingaben bleiben nachvollziehbare Stopps.
Aus dieser Teststrecke folgt keine automatische Zahlung oder allgemeine
Buchungsfreigabe. Der abgeschlossene Northwind-Testfall ist kein Restpunkt.

## Lesebefund vom 27.11.2026

Die Projektliste meldet das ursprüngliche PetraPlan-Projekt
`yxhllviostywckxoehgf` und das separate `PetraPlanTest`-Projekt als `INACTIVE`.
Auf dem ursprünglichen Projekt wurden ausschließlich die Migrationsliste und
eine lesende Tabellen-/RLS-Katalogabfrage versucht. Beide Aufrufe lieferten
`INVALID_ARGUMENT`, keinen Schema- oder Migrationsbefund. Daraus wird keine
weitere Ursache abgeleitet. Es wurde kein Projekt gestartet oder verändert.

Der aktuelle gehostete Schemaabgleich bleibt deshalb offen. Vor der
Gesamtabnahme Projektverfügbarkeit klären und die read-only Inventur erneut
auf dem ausdrücklich vorgesehenen Testschema ausführen. Die Freischaltung
von Vercel allein belegt keine verfügbare Datenbank oder fertige Teststrecke.

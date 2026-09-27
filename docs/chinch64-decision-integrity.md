# Chinch64 — atomare Entscheidungen und genaue Freigabebasis

Basis: `14aa6832cfa969839bc4a446dabc6c324661bbee` (25.09.2026).

## Verhalten

- `confirm_candidate` und `reject_candidate` rufen eine einzige Datenbankfunktion auf. Kandidatenzustand und Historie werden gemeinsam gespeichert oder vollständig zurückgerollt.
- Rolle, Fall, vollständig verarbeiteter Snapshot, Kandidatenzuordnung und Ausgangszustand werden beim Schreiben erneut geprüft. Wiederholte Entscheidungen liefern HTTP 409.
- Freigabe erfordert ein vollständiges genehmigtes Review mit derselben Validierung, Auflösung und Snapshot-Referenz. Alle erforderlichen Kriterien werden gegen den Kriterienkatalog geprüft.
- Freigabezertifikat, eigene Zustandshistorie, Release-Log und Entscheidungs-Audit werden gemeinsam gespeichert. Fehler hinterlassen keine halbe Freigabe.
- Eine unverändert wiederholte Freigabe verwendet nur ein bereits vertrauenswürdiges Zertifikat mit exakt derselben Basis. Bei anderer Basis oder nach Widerruf entsteht ein neues Zertifikat; alte Zertifikate werden nicht umgeschrieben oder reaktiviert.
- Eine spätere erfolgreiche Validierung erbt keine alte Freigabe. Die Leseansicht zeigt `superseded`, bis ein neues Review und eine ausdrückliche Freigabe vorliegen. Ein Widerruf bleibt ein Widerruf.
- Server-RPCs sind ausschließlich für `service_role` ausführbar. Der Actor stammt aus der serverseitig geprüften Sitzung. Browserrollen dürfen keine Actor-ID an die RPCs durchreichen.
- Die vier Phasen und die fachlichen STATUS-/MENGE-Regeln bleiben unverändert. Kandidatenentscheidungen schreiben weder Source Truth noch Validierung noch Freigabe.

## Datenbankänderung und Bereitstellung

Migration: `supabase/migrations/20260927215417_chinch64_decision_integrity.sql`.

**Noch nicht auf die Live-Datenbank angewendet.** Der erreichbare Supabase-Zugang hat keine Berechtigung für das im Frontend konfigurierte PetraPlan-Projekt `yxhllviostywckxoehgf`. Das andere verbundene Projekt wurde nicht verändert.

Vor einem Merge nach `main`:

1. Im richtigen Projekt die vorhandenen Tabellen, Spaltentypen, Constraints, Trigger und Grants mit dieser Migration abgleichen. Besonders `release_logs.event_type`, `release_status_history.previous_status`, zusätzliche Pflichtspalten und eventuell vorhandene Ein-Zertifikat-pro-Fall-Constraints prüfen. Das ZIP enthält nicht das vollständige Live-Schema.
2. Migration zuerst in einer passenden Testdatenbank anwenden. Vorhandene RLS-/Append-only-Regeln und Audit-Trigger beibehalten. Keine Source- oder historischen Entscheidungsdaten ändern.
3. Berechtigungen und SQL-Sicherheitsprüfung ausführen. Funktionen sind `SECURITY INVOKER`, mit leerem `search_path` und expliziten Tabellenbezügen. Keine neuen Tabellen und keine neuen Browser-Schreibrechte.
4. Migration im richtigen Projekt anwenden, danach App-Code bereitstellen. Ohne die neuen RPCs liefert die App absichtlich HTTP 503 statt auf die alten Teil-Schreibvorgänge zurückzufallen.
5. Den vollständigen authentifizierten Ablauf in der bereitgestellten App prüfen, einschließlich erneutem Review nach Neuvalidierung. Erst danach als live verifiziert bezeichnen.

Die Trigger sperren den Fall bei Kandidatenänderungen und beim Anlegen von Validierungen, Review-Sitzungen und Review-Entscheidungen. Die Freigabe prüft ihre Basis innerhalb derselben Fallsperre erneut. Konkurrierende Anfragen auf einem echten PostgreSQL-Server sind zusätzlich vor Produktion zu prüfen; PGlite führt die lokalen Datenbanktests sequenziell aus.

## Reproduzierbare Prüfung

```sh
npm ci
npm test
npm run test:decision-integrity
npm ci --prefix frontend/mobile-app
npm run typecheck --prefix frontend/mobile-app
npm run build --prefix frontend/mobile-app
```

`test:decision-integrity` kompiliert den tatsächlichen API-Endpunkt und prüft seine Antworten mit einem kontrollierten Datenbankclient. Die Datenbanktests führen die tatsächlichen SQL-Funktionen in PGlite/PostgreSQL aus. Sie nutzen die vorhandene Address-Layer-Definition sowie eine reduzierte Fixture für die übrigen Tabellen — keine Behauptung über das Live-Schema.

Gezielte Fehlerfälle: Historienfehler, Auditfehler, Doppelentscheidung, fremder Snapshot, fehlende Rolle, Browser-RPC-Aufruf, offene Kandidaten, altes Review, neuere unvollständige Review-Sitzung, abweichende Validierungsreferenzen, fehlende Kriterien, negative Prüfung, wiederholte Freigabe und neue Zertifikatsbasis.

## Bewusst noch offen

Die Belegprüfung bestätigter STATUS-/MENGE-Vorschläge in der Neuvalidierung ist der nächste Arbeitsschritt. Review-Erfassung und manueller Widerruf verwenden weiterhin ihre vorhandenen API-Pfade; deren vollständige Transaktionsumstellung gehört nicht zu dieser Änderung. Ein öffentlicher Live-Nachweis für A-10266 wurde hier nicht erzeugt.

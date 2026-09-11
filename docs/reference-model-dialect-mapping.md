# PetraPlan – Referenzmodell, Dialekt und Mapping

Dieses Dokument hält die internen Architekturprinzipien fest, die wir aus etablierten ORM-/Hibernate-Mustern für die PetraPlan-Bridge ableiten.

Vertiefende Ableitungen aus dem vollständigen Hibernate-Leseblock stehen in [`hibernate-derived-architecture.md`](./hibernate-derived-architecture.md).

Es ist **keine neue öffentliche Methode**. Der Entknotungs-Check bleibt bei genau vier Phasen:

1. Eingang
2. Übersetzung
3. Prüfung
4. Entscheidung

Die folgenden Ebenen erklären nur, wie wir intern denken, wenn wir eine bestehende Systemlandschaft verstehen.

## Grundidee

PetraPlan soll eine bestehende Quelle nicht neu erfinden und nicht vorschnell interpretieren.

Der sichere Denkweg lautet:

**Referenz kennen → Konfiguration lesen → technische Ausprägung erkennen → Mapping prüfen → reale Struktur bestätigen**

Oder als internes Schichtenmodell:

1. **Kern / Referenzmodell**  
   Allgemeine fachliche oder technische Struktur, gegen die eine konkrete Instanz eingeordnet werden kann.

2. **Konfiguration**  
   Einstellungen, deklarierte Regeln, Mapping-Dateien, Metadaten und andere Hinweise darauf, wie die konkrete Umgebung aufgebaut ist.

3. **Dialekt / technische Ausprägung**  
   Systemspezifische Variante: Datenbankdialekt, Treiber, lokale Erweiterungen, unterstützte Fähigkeiten und andere konkrete Besonderheiten.

4. **Mapping / Übersetzung**  
   Explizite Zuordnung zwischen Modellen und Strukturen, z. B. Feld ↔ Feld, Wert ↔ Wert, Typ ↔ Typ, Objekt ↔ Tabelle, Attribut ↔ Spalte, Identität ↔ Identität und Relation ↔ Relation.

5. **Reale Systeminstanz**  
   Tatsächlich vorhandene Tabellen, Felder, Schlüssel, Beziehungen, Werte, Status, Untertypen, lokale Besonderheiten und Laufzeitzustände.

## Wichtigste Sicherheitsregel

Ein Referenzmodell darf den Suchraum verkleinern, aber niemals die konkrete Instanz ersetzen.

PetraPlan darf aus einem erwartbaren Muster eine **Hypothese** bilden. Eine konkrete Zuordnung gilt erst dann als bestätigt, wenn sie durch die Quelle selbst, belastbare Metadaten, Konfiguration, Dokumentation oder andere geeignete Evidenz gestützt wird.

Daraus folgt:

- Referenzwissen ist Orientierung, kein Beweis.
- Metadaten beschreiben Struktur, nicht automatisch fachliche Bedeutung.
- Unbekannte lokale Felder oder Werte werden nicht geraten.
- Abweichungen werden sichtbar gemacht, nicht automatisch korrigiert.
- Nur bestätigte Übersetzungen gelangen in das Canonical Model.
- Die Quelle bleibt unverändert.

## Übernommene Architekturprinzipien aus ORM-/Hibernate-Mustern

### Zugriff und Fachbedeutung trennen

Ein technischer Zugriffspfad sagt nur, **wie** etwas gelesen werden kann. Er entscheidet nicht, **was** ein Wert fachlich bedeutet.

Für PetraPlan heißt das:

- Adapter / Source Access lesen.
- Mapping beschreibt Zuordnungen.
- Constraints prüfen fachliche Regeln.
- Nur die Entscheidungslogik bestimmt Freigabe oder Blockierung.

**Zugriffskontext ≠ Fachregel.**

### Mapping als eigenständige, prüfbare Schicht

ORM-Systeme zeigen, dass zwischen Objektmodell und Datenbankstruktur eine explizite Übersetzung liegt.

PetraPlan behandelt Mapping deshalb nicht als versteckte Hilfsfunktion, sondern als nachvollziehbaren Teil der Bridge:

- Field Map
- Value Map
- Type / Conversion Mapping
- Identity Mapping
- Relation Mapping
- Subtype / Discriminator Mapping
- Herkunft und Mapping-Version

### Identität gehört vor die Übersetzung

Ein Objekt ist nicht automatisch über genau ein Feld eindeutig.

Eine reale Instanz kann natürliche, technische oder zusammengesetzte Schlüssel verwenden. PetraPlan muss deshalb unterscheiden zwischen:

- Kandidat für dieselbe Entität
- bestätigter Identität
- zusammengesetzten Schlüsselbestandteilen
- Quellidentität
- kanonischer Identität

**Candidate match ≠ confirmed same_entity.**

Erst wenn alle erforderlichen Identitätsbestandteile bestätigt sind, darf eine Zuordnung als dieselbe Entität verwendet werden.

### Beziehungen gehören zur Struktur

Ein System besteht nicht nur aus isolierten Feldern. Beziehungen zwischen Objekten, Tabellen und Geschäftsobjekten können entscheidenden Kontext liefern.

Eine Relationsanalyse muss unterscheiden zwischen:

- Identität
- Beziehung
- Richtung
- Kardinalität
- technischer Verknüpfung
- Owner-/Inverse-Seite
- Join-Tabelle
- Association Entity
- bestätigter fachlicher Bedeutung

Eine technische Relation ist noch keine fachliche Wahrheit.

Ebenso wichtig:

**Eine Beziehung kann selbst Bedeutung tragen.**

Eine Join-Struktur kann reine Technik sein, aber auch ein eigenständiges fachliches Objekt mit eigenen Attributen.

### Vererbung und konkrete Systemausprägung

Ein gemeinsamer fachlicher Kern kann mehrere technische Untertypen oder Speicherstrategien haben.

PetraPlan muss deshalb zwischen gemeinsamem Referenztyp und konkreter Instanzausprägung unterscheiden, z. B. anhand von:

- Basistyp
- Untertyp
- Discriminator-Feld / -Wert
- gemeinsam genutzten Feldern
- untertypspezifischen Feldern
- Tabellenstrategie

Ein Discriminator ist Evidenz für eine Ausprägung, aber ersetzt nicht die Prüfung des konkreten Kontexts.

### Collections und Sortierung sind technische Formen

Liste, Set, Map, Bag, Array, Join-Tabelle oder sortierte Collection können dieselbe fachliche Beziehung unterschiedlich repräsentieren.

Darum gilt:

- Speicherform und Fachbedeutung getrennt halten.
- Reihenfolge nicht als Geschäftsregel interpretieren, solange sie nicht bestätigt ist.
- Canonical Model nach Bedeutung bauen, nicht nach ORM-Darstellung.

### Laufzeitkontext ist beobachtbare Evidenz

Session-, Lade-, Versions- und Konfliktzustände zeigen, dass derselbe fachliche Datensatz in unterschiedlichen technischen Zuständen auftreten kann.

Für die Bridge ist daraus wichtig:

- Snapshot und Beobachtungszeitpunkt festhalten.
- Version / Freshness berücksichtigen, wenn verfügbar.
- Konflikte zwischen Beobachtungen sichtbar machen.
- Einen Laufzeitzustand nicht mit Source Truth verwechseln.

### Adressierbar ist nicht gleich vollständig geladen

Lazy-Loading-Muster zeigen ein allgemeines Prinzip: Eine Information kann bekannt und adressierbar sein, ohne dass ihr kompletter Inhalt bereits materialisiert wurde.

Das passt zur PetraPlan-Leitidee:

**Erreichbar machen vor Ersetzen.**

Die Bridge muss nicht vorsorglich alles kopieren. Sie soll zuerst nachvollziehbar wissen, was vorhanden ist, wo es liegt und unter welchen bestätigten Regeln es gelesen werden kann.

### Mehrere Zugriffssprachen, ein zugrunde liegendes Modell

HQL, Criteria und SQL zeigen, dass dieselbe Datenwelt über unterschiedliche Zugriffssprachen beschrieben werden kann.

Für PetraPlan bedeutet das:

- Zugriffsdialekt und fachliche Bedeutung getrennt halten.
- Unterschiede zwischen Zugriffspfaden explizit dokumentieren.
- Ein gemeinsames Canonical Model nicht mit einer einzelnen Query-Sprache verwechseln.

### Read-only-Modelle sind legitim

Für Berichte oder Analysezwecke braucht ein System nicht zwingend ein voll schreibfähiges Domänenmodell.

PetraPlan bevorzugt deshalb bewusst eine **read-only Analyse- und Übersetzungsschicht**.

## Bestätigtes Instanzprofil

Das Instanzprofil soll künftig mehr als nur Feldnamen enthalten.

Mindestens relevant sind:

- Source / Schema / Catalog
- Entity / Tabelle
- Felder / Spalten
- Quell-Datentypen
- Primärschlüssel
- zusammengesetzte Schlüssel
- Fremdschlüssel
- nullable / required
- technische Defaults
- Beziehungen / Kardinalitäten
- Join-Strukturen
- Collection-/Storage-Shape
- Vererbungs-/Subtype-Metadaten
- Snapshot / Zeitpunkt / Evidence References

Diese Struktur beschreibt die beobachtete Instanz. Fachliche Bedeutung muss weiterhin separat bestätigt werden.

## Was wir bewusst nicht übernehmen

Bestimmte Hibernate-Themen sind wichtiges Hintergrundwissen, gehören aber nicht in den PetraPlan-Produktkern:

- produktive Schreibzugriffe auf Quellsysteme
- automatische Korrekturen an Quellwerten
- Transaktionssteuerung für Writes
- Commit-/Rollback-Orchestrierung als Bridge-Funktion
- automatische Merge-/Update-Logik zurück in die Quelle
- automatische ID-Erzeugung für Quelldaten
- Cascading-Schreiboperationen
- pessimistische Sperren als Produktmechanismus
- Cache-Inhalte als Source Truth
- automatisch generierte Semantik ohne Bestätigung
- Schema-Erzeugung oder Schema-Mutation als Bridge-Funktion

PetraPlan liest, ordnet ein, übersetzt, prüft, entscheidet und dokumentiert. Die Quelle wird nicht zurückgeschrieben.

## Einordnung in die vier öffentlichen Phasen

### 1. Eingang

- Quelle und Snapshot erfassen
- technische Identität und Zugriffskontext prüfen
- Metadaten / Struktur lesen
- Primär-/Fremdschlüssel und Relationsstruktur beobachten
- Untertyp-/Discriminator-Evidenz erfassen
- Referenzrahmen nur als Orientierung verwenden

### 2. Übersetzung

- Dialekt / technische Ausprägung bestimmen
- Identität bestätigen, bevor Relation oder Mapping darauf aufbaut
- Field Map, Value Map und Type Conversion anwenden
- bestätigte Identity-/Relation-/Subtype-Mappings anwenden
- Beziehungen nur mit bestätigtem Kontext interpretieren
- Canonical Model ausschließlich aus bestätigten Zuordnungen aufbauen

### 3. Prüfung

- Schema-, Daten-, Semantik- und Beziehungskonflikte prüfen
- Identität und zusammengesetzte Schlüssel prüfen
- Kardinalität und Relationskonsistenz prüfen, wenn fachlich relevant
- Versionen / Freshness / konkurrierende Beobachtungen berücksichtigen
- offene oder nicht belegte Bedeutungen sichtbar halten

### 4. Entscheidung

- VALID, NEEDS_CONFIRMATION oder BLOCKED aus den belegten Prüfungen ableiten
- Ergebnis mit Snapshot-, Mapping-, Contract- und Regelversion dokumentieren
- sicheren nächsten Schritt benennen
- keine automatische Mutation der Quelle

## Interner Merksatz

**Nicht jedes Detail zuerst erraten. Erst den Referenzrahmen verstehen, dann die konkrete Instanz befragen, Identität und Beziehungen belegen, Abweichungen sichtbar machen und nur bestätigte Übersetzungen verwenden.**
